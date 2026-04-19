import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import {
  assertEntitlement,
  incrementUsage,
  requireUser,
  type ProfileRow
} from "../_shared/auth.ts";
import { corsHeaders } from "../_shared/http.ts";
import { assertMaxJsonBodyBytes, readJsonBodyWithByteLimit } from "../_shared/requestLimits.ts";

function readEnvironmentValue(name: string): string | undefined {
  const deno = (globalThis as { Deno?: { env?: { get: (key: string) => string | undefined } } })
    .Deno;

  if (deno?.env) {
    return deno.env.get(name);
  }

  if (typeof process !== "undefined" && process.env) {
    const value = process.env[name];
    return typeof value === "string" ? value : undefined;
  }

  return undefined;
}

function resolveOpenAiApiKey(request: Request): string | null {
  const billingMode = request.headers.get("x-trellis-billing-mode");

  if (billingMode === "byok") {
    const provider = request.headers.get("x-trellis-provider");
    const providerApiKey = request.headers.get("x-trellis-provider-key")?.trim();

    if (provider === "openai" && providerApiKey) {
      return providerApiKey;
    }

    return null;
  }

  return readEnvironmentValue("OPENAI_API_KEY")?.trim() ?? null;
}

async function readProviderError(response: Response): Promise<string | null> {
  const text = await response.text();

  if (text.trim().length === 0) {
    return null;
  }

  try {
    const payload = JSON.parse(text) as Record<string, unknown>;
    const errorValue = payload.error;

    if (typeof errorValue === "string" && errorValue.length > 0) {
      return errorValue;
    }

    if (typeof payload.message === "string" && payload.message.length > 0) {
      return payload.message;
    }
  } catch {
    return text.trim();
  }

  return text.trim();
}

function shouldSkipHostedMediaUsageIncrement(
  profile: ProfileRow,
  request: Request,
  previewWorkspaceRequest: boolean
): boolean {
  if (request.headers.get("x-trellis-billing-mode") === "byok") {
    return true;
  }
  if (previewWorkspaceRequest && profile.is_admin === true) {
    return true;
  }
  return false;
}

async function recordHostedMediaMessageUsage(
  admin: SupabaseClient,
  userId: string,
  profile: ProfileRow,
  request: Request,
  previewWorkspaceRequest: boolean,
  metadata: Record<string, unknown>
): Promise<void> {
  if (shouldSkipHostedMediaUsageIncrement(profile, request, previewWorkspaceRequest)) {
    return;
  }
  await incrementUsage(admin, userId, "message", 1, metadata, {});
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", {
      headers: corsHeaders
    });
  }

  try {
    assertMaxJsonBodyBytes(request);
    const { user, profile, admin } = await requireUser(request);
    const previewWorkspaceRequest = request.headers.get("x-trellis-preview-workspace") === "1";
    assertEntitlement(profile, "message");

    const body = (await readJsonBodyWithByteLimit(request)) as Record<string, unknown>;
    const action = typeof body.action === "string" ? body.action : "";
    const apiKey = resolveOpenAiApiKey(request);

    if (!apiKey) {
      throw new Response(
        JSON.stringify({
          error:
            "Voice and image features need an OpenAI API key. Add your OpenAI key in Settings (BYOK), or use a hosted plan with OpenAI configured."
        }),
        {
          status: 400,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json"
          }
        }
      );
    }

    if (action === "transcribe") {
      const audioBase64 = typeof body.audioBase64 === "string" ? body.audioBase64 : "";
      const mimeType = typeof body.mimeType === "string" ? body.mimeType : "audio/webm";

      if (audioBase64.length < 16) {
        throw new Response(JSON.stringify({ error: "No audio data received." }), {
          status: 400,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json"
          }
        });
      }

      const bytes = Uint8Array.from(atob(audioBase64.replace(/^data:[^;]+;base64,/, "")), (c) =>
        c.charCodeAt(0)
      );
      const blob = new Blob([bytes], { type: mimeType });
      const form = new FormData();
      form.append("file", blob, "audio.webm");
      form.append("model", "whisper-1");

      const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`
        },
        body: form
      });

      if (!response.ok) {
        const msg = await readProviderError(response);
        throw new Response(
          JSON.stringify({
            error: msg ? `Transcription failed: ${msg}` : "Transcription failed."
          }),
          {
            status: response.status,
            headers: {
              ...corsHeaders,
              "Content-Type": "application/json"
            }
          }
        );
      }

      const payload = (await response.json()) as { text?: string };
      const text = typeof payload.text === "string" ? payload.text.trim() : "";

      await recordHostedMediaMessageUsage(admin, user.id, profile, request, previewWorkspaceRequest, {
        media_action: "transcribe",
        billing_mode: request.headers.get("x-trellis-billing-mode") === "byok" ? "byok" : "hosted"
      });

      return new Response(JSON.stringify({ text }), {
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }

    if (action === "tts") {
      const text = typeof body.text === "string" ? body.text : "";
      const wantStream = body.stream === true;
      const speedRaw = body.speed;
      /** Default matches tier 3 ("Medium", OpenAI speed 1.0) when the client omits `speed`. */
      const ttsSpeed =
        typeof speedRaw === "number" && Number.isFinite(speedRaw)
          ? Math.min(4, Math.max(0.25, speedRaw))
          : 1;

      if (text.length < 1) {
        throw new Response(JSON.stringify({ error: "No text to speak." }), {
          status: 400,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json"
          }
        });
      }

      if (wantStream) {
        const response = await fetch("https://api.openai.com/v1/audio/speech", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`
          },
          body: JSON.stringify({
            model: "tts-1",
            voice: "alloy",
            input: text.slice(0, 4096),
            response_format: "pcm",
            stream_format: "audio",
            speed: ttsSpeed
          })
        });

        if (!response.ok) {
          const msg = await readProviderError(response);
          throw new Response(
            JSON.stringify({
              error: msg ? `Speech synthesis failed: ${msg}` : "Speech synthesis failed."
            }),
            {
              status: response.status,
              headers: {
                ...corsHeaders,
                "Content-Type": "application/json"
              }
            }
          );
        }

        const outBody = response.body;
        if (!outBody) {
          throw new Response(
            JSON.stringify({ error: "Speech synthesis returned no audio stream." }),
            {
              status: 502,
              headers: {
                ...corsHeaders,
                "Content-Type": "application/json"
              }
            }
          );
        }

        await recordHostedMediaMessageUsage(admin, user.id, profile, request, previewWorkspaceRequest, {
          media_action: "tts",
          billing_mode: request.headers.get("x-trellis-billing-mode") === "byok" ? "byok" : "hosted",
          stream: true
        });

        return new Response(outBody, {
          status: 200,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/octet-stream",
            "Cache-Control": "no-store",
            "X-Trellis-Pcm-Sample-Rate": "24000"
          }
        });
      }

      const response = await fetch("https://api.openai.com/v1/audio/speech", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model: "tts-1",
          voice: "alloy",
          input: text.slice(0, 4096),
          speed: ttsSpeed
        })
      });

      if (!response.ok) {
        const msg = await readProviderError(response);
        throw new Response(
          JSON.stringify({
            error: msg ? `Speech synthesis failed: ${msg}` : "Speech synthesis failed."
          }),
          {
            status: response.status,
            headers: {
              ...corsHeaders,
              "Content-Type": "application/json"
            }
          }
        );
      }

      const buf = new Uint8Array(await response.arrayBuffer());
      let binary = "";
      const chunkSize = 8192;
      for (let i = 0; i < buf.length; i += chunkSize) {
        const chunk = buf.subarray(i, i + chunkSize);
        binary += String.fromCharCode(...chunk);
      }
      const audioBase64 = btoa(binary);

      await recordHostedMediaMessageUsage(admin, user.id, profile, request, previewWorkspaceRequest, {
        media_action: "tts",
        billing_mode: request.headers.get("x-trellis-billing-mode") === "byok" ? "byok" : "hosted",
        stream: false
      });

      return new Response(
        JSON.stringify({
          audioBase64,
          mimeType: "audio/mpeg"
        }),
        {
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json"
          }
        }
      );
    }

    if (action === "image_generate") {
      const prompt = typeof body.prompt === "string" ? body.prompt : "";

      if (prompt.length < 1) {
        throw new Response(JSON.stringify({ error: "Enter a prompt to generate an image." }), {
          status: 400,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json"
          }
        });
      }

      const response = await fetch("https://api.openai.com/v1/images/generations", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model: "dall-e-3",
          prompt: prompt.slice(0, 4000),
          n: 1,
          size: "1024x1024",
          response_format: "b64_json"
        })
      });

      if (!response.ok) {
        const msg = await readProviderError(response);
        throw new Response(
          JSON.stringify({
            error: msg ? `Image generation failed: ${msg}` : "Image generation failed."
          }),
          {
            status: response.status,
            headers: {
              ...corsHeaders,
              "Content-Type": "application/json"
            }
          }
        );
      }

      const payload = (await response.json()) as {
        data?: Array<{ b64_json?: string; revised_prompt?: string }>;
      };
      const b64 = payload.data?.[0]?.b64_json;
      const revisedPrompt = payload.data?.[0]?.revised_prompt;

      if (typeof b64 !== "string" || b64.length === 0) {
        throw new Response(JSON.stringify({ error: "Image generation returned no image data." }), {
          status: 502,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json"
          }
        });
      }

      await recordHostedMediaMessageUsage(admin, user.id, profile, request, previewWorkspaceRequest, {
        media_action: "image_generate",
        billing_mode: request.headers.get("x-trellis-billing-mode") === "byok" ? "byok" : "hosted"
      });

      return new Response(
        JSON.stringify({
          imageBase64: b64,
          revisedPrompt: typeof revisedPrompt === "string" ? revisedPrompt : undefined
        }),
        {
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json"
          }
        }
      );
    }

    throw new Response(JSON.stringify({ error: "Unknown media action." }), {
      status: 400,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      }
    });
  } catch (error) {
    if (error instanceof Response) {
      return error;
    }

    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : "Media request failed."
      }),
      {
        status: 500,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      }
    );
  }
});
