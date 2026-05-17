import type { SubscriptionTier } from "@trellis/contracts";
import {
  normalizeReadAloudSpeedTier,
  readAloudSpeedTierToOpenAiSpeed,
  type ReadAloudSpeedTier
} from "@trellis/shared/media/readAloudSpeed";
import { getSupabase, hasSupabaseConfig } from "@/lib/supabase";

const functionsBaseUrl = `${import.meta.env.VITE_SUPABASE_URL?.trim() ?? ""}/functions/v1`;
const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim() ?? "";

let activeSpeechAbort: AbortController | null = null;

export function cancelChatMediaSpeechStream(): void {
  activeSpeechAbort?.abort();
  activeSpeechAbort = null;
}

function buildChatMediaHeaders(input: {
  accessToken: string;
  subscriptionTier: SubscriptionTier;
  previewWorkspace: boolean;
}): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    apikey: publishableKey,
    Authorization: `Bearer ${input.accessToken}`
  };

  if (input.subscriptionTier === "byok") {
    headers["x-trellis-billing-mode"] = "byok";
    headers["x-trellis-provider"] = "openai";
  }

  if (input.previewWorkspace) {
    headers["x-trellis-preview-workspace"] = "1";
  }

  return headers;
}

async function readFunctionError(response: Response, fallbackMessage: string): Promise<Error> {
  const text = await response.text();

  try {
    const payload = JSON.parse(text) as {
      error?: string;
      message?: string;
    };

    if (typeof payload.error === "string" && payload.error.length > 0) {
      return new Error(payload.error);
    }

    if (typeof payload.message === "string" && payload.message.length > 0) {
      return new Error(payload.message);
    }
  } catch {
    if (text.length > 0) {
      return new Error(text);
    }
  }

  return new Error(fallbackMessage);
}

export async function transcribeAudioBridged(input: {
  accessToken: string;
  subscriptionTier: SubscriptionTier;
  audioBase64: string;
  mimeType: string;
  previewWorkspace: boolean;
}): Promise<{ text: string }> {
  if (!hasSupabaseConfig() || publishableKey.length === 0) {
    throw new Error("Cloud features are not configured for this build yet.");
  }

  const response = await fetch(`${functionsBaseUrl}/chat-media`, {
    method: "POST",
    headers: buildChatMediaHeaders(input),
    body: JSON.stringify({
      action: "transcribe",
      audioBase64: input.audioBase64,
      mimeType: input.mimeType
    })
  });

  if (!response.ok) {
    throw await readFunctionError(response, "Transcription failed.");
  }

  const payload = (await response.json()) as { text?: string };

  if (typeof payload.text !== "string") {
    throw new Error("Transcription returned no text.");
  }

  return { text: payload.text };
}

export async function synthesizeSpeechStreamBridged(
  input: {
    accessToken: string;
    subscriptionTier: SubscriptionTier;
    text: string;
    readAloudSpeed: ReadAloudSpeedTier;
    previewWorkspace: boolean;
  },
  onChunk: (chunk: Uint8Array) => void
): Promise<void> {
  if (!hasSupabaseConfig() || publishableKey.length === 0) {
    throw new Error("Cloud features are not configured for this build yet.");
  }

  cancelChatMediaSpeechStream();
  const ac = new AbortController();
  activeSpeechAbort = ac;

  const speed = readAloudSpeedTierToOpenAiSpeed(normalizeReadAloudSpeedTier(input.readAloudSpeed));

  try {
    const response = await fetch(`${functionsBaseUrl}/chat-media`, {
      method: "POST",
      headers: buildChatMediaHeaders(input),
      body: JSON.stringify({
        action: "tts",
        text: input.text,
        stream: true,
        speed
      }),
      signal: ac.signal
    });

    if (!response.ok) {
      throw await readFunctionError(response, "Speech synthesis failed.");
    }

    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error("Speech synthesis returned no stream.");
    }

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }
        if (value.length > 0) {
          onChunk(value);
        }
      }
    } finally {
      reader.releaseLock();
    }
  } catch (error: unknown) {
    const isAbort =
      error instanceof Error &&
      (error.name === "AbortError" ||
        error.message === "This operation was aborted" ||
        error.message.includes("aborted"));
    if (isAbort) {
      return;
    }
    throw error;
  } finally {
    if (activeSpeechAbort === ac) {
      activeSpeechAbort = null;
    }
  }
}

export async function generateChatImageBridged(input: {
  accessToken: string;
  subscriptionTier: SubscriptionTier;
  prompt: string;
  previewWorkspace: boolean;
}): Promise<{ imageBase64: string; revisedPrompt?: string }> {
  if (!hasSupabaseConfig() || publishableKey.length === 0) {
    throw new Error("Cloud features are not configured for this build yet.");
  }

  const response = await fetch(`${functionsBaseUrl}/chat-media`, {
    method: "POST",
    headers: buildChatMediaHeaders(input),
    body: JSON.stringify({
      action: "image_generate",
      prompt: input.prompt
    })
  });

  if (!response.ok) {
    throw await readFunctionError(response, "Image generation failed.");
  }

  const payload = (await response.json()) as {
    imageBase64?: string;
    revisedPrompt?: string;
  };

  if (typeof payload.imageBase64 !== "string") {
    throw new Error("Image generation returned no image.");
  }

  return {
    imageBase64: payload.imageBase64,
    revisedPrompt: typeof payload.revisedPrompt === "string" ? payload.revisedPrompt : undefined
  };
}
