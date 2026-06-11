import { extractionPrompt } from "./prompts.ts";
import {
  cloudExtractionMaxOutputTokens,
  cloudExtractionModels
} from "../../../shared/extraction/config.ts";

export function mapCloudExtractionHttpError(status: number): string {
  if (status === 401) {
    return "The provider API key was rejected. Check API keys in Settings.";
  }
  if (status === 429) {
    return "Cloud note processing was rate-limited.";
  }
  if (status >= 500) {
    return "The provider API returned a server error.";
  }
  return `Cloud note processing failed (HTTP ${status}).`;
}

export async function extractOpenAiJson(apiKey: string, userMessage: string): Promise<string> {
  const body = JSON.stringify({
    model: cloudExtractionModels.openai,
    temperature: 0.22,
    max_tokens: cloudExtractionMaxOutputTokens,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: extractionPrompt },
      { role: "user", content: userMessage }
    ]
  });
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(mapCloudExtractionHttpError(res.status));
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    throw new Error("Cloud note processing returned a non-JSON response.");
  }
  const rec = parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
  const choices = rec?.choices;
  const first =
    Array.isArray(choices) && choices.length > 0 && choices[0] && typeof choices[0] === "object"
      ? (choices[0] as Record<string, unknown>)
      : null;
  const message =
    first?.message && typeof first.message === "object"
      ? (first.message as Record<string, unknown>)
      : null;
  const content = typeof message?.content === "string" ? message.content : "";
  if (!content.trim()) {
    throw new Error("Cloud note processing returned an empty response.");
  }
  return content.trim();
}

export async function extractAnthropicJson(apiKey: string, userMessage: string): Promise<string> {
  const body = JSON.stringify({
    model: cloudExtractionModels.anthropic,
    max_tokens: cloudExtractionMaxOutputTokens,
    temperature: 0.22,
    system: extractionPrompt,
    messages: [
      { role: "user", content: userMessage },
      { role: "assistant", content: "{" }
    ]
  });
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json"
    },
    body
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(mapCloudExtractionHttpError(res.status));
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    throw new Error("Cloud note processing returned a non-JSON response.");
  }
  const rec = parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
  const contentBlocks = rec?.content;
  let fragment = "";
  if (Array.isArray(contentBlocks)) {
    for (const block of contentBlocks) {
      if (block && typeof block === "object") {
        const b = block as Record<string, unknown>;
        if (b.type === "text" && typeof b.text === "string") {
          fragment += b.text;
        }
      }
    }
  }
  fragment = fragment.trim();
  if (!fragment) {
    throw new Error("Cloud note processing returned an empty response.");
  }
  return fragment.startsWith("{") ? fragment : `{${fragment}`;
}
