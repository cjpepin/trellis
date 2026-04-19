import {
  cloudExtractionMaxOutputTokens,
  cloudExtractionModels
} from "../../../../shared/extraction/config";
import { buildExtractionUserMessage } from "../../../../shared/extraction/buildPrompt";
import { parseExtractionResponseJson } from "../../../../shared/extraction/validate";
import { extractionPrompt } from "../../../../supabase/functions/_shared/prompts";
import type { ChatProvider, ExtractionProviderId } from "../../../ipc/types";
import { fetchSafeHttpsPost } from "../../fetchSafe";
import { ExtractionValidationError } from "../debug";
import type { ExtractionProvider } from "./types";

function mapHttpError(status: number): string {
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

function retrySuffix(retryThorough: boolean | undefined): string {
  return retryThorough
    ? "\n\n## Second pass\n" +
        "The previous extraction pass returned no durable note operations. Re-read the transcript above. " +
        "If it contains any concrete takeaway, decision, definition, preference, plan, named entity, or technical detail someone might search for later, return one concise synthesis or concept note. " +
        "Prefer updating or creating a real note over noop. Only return an empty updates array if the thread is purely social, empty, or content-free.\n"
    : "";
}

async function extractOpenAi(
  apiKey: string,
  input: Parameters<ExtractionProvider["extract"]>[0]
): Promise<{ content: string }> {
  const userMessage = buildExtractionUserMessage(input, { maxCorpusChars: 40_000 }) + retrySuffix(input.retryThorough);
  const body = JSON.stringify({
    model: cloudExtractionModels.openai,
    temperature: input.retryThorough ? 0.42 : 0.22,
    max_tokens: cloudExtractionMaxOutputTokens,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: extractionPrompt },
      { role: "user", content: userMessage }
    ]
  });
  const res = await fetchSafeHttpsPost("https://api.openai.com/v1/chat/completions", {
    headers: {
      Authorization: `Bearer ${apiKey}`
    },
    body
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(mapHttpError(res.status));
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
  const message = first?.message && typeof first.message === "object" ? (first.message as Record<string, unknown>) : null;
  const content = typeof message?.content === "string" ? message.content : "";
  if (!content.trim()) {
    throw new Error("Cloud note processing returned an empty response.");
  }
  return { content: content.trim() };
}

async function extractAnthropic(
  apiKey: string,
  input: Parameters<ExtractionProvider["extract"]>[0]
): Promise<{ content: string }> {
  const userMessage = buildExtractionUserMessage(input, { maxCorpusChars: 40_000 }) + retrySuffix(input.retryThorough);
  const body = JSON.stringify({
    model: cloudExtractionModels.anthropic,
    max_tokens: cloudExtractionMaxOutputTokens,
    temperature: input.retryThorough ? 0.42 : 0.22,
    system: extractionPrompt,
    messages: [
      { role: "user", content: userMessage },
      { role: "assistant", content: "{" }
    ]
  });
  const res = await fetchSafeHttpsPost("https://api.anthropic.com/v1/messages", {
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01"
    },
    body
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(mapHttpError(res.status));
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
  const fullJson = fragment.startsWith("{") ? fragment : `{${fragment}`;
  return { content: fullJson };
}

export function createCloudExtractionProvider(
  chatProvider: ChatProvider,
  getApiKey: () => string | null
): ExtractionProvider {
  const id: ExtractionProviderId = chatProvider === "openai" ? "cloud-openai" : "cloud-anthropic";
  const label = chatProvider === "openai" ? "Cloud (OpenAI)" : "Cloud (Anthropic)";
  const modelId =
    chatProvider === "openai" ? cloudExtractionModels.openai : cloudExtractionModels.anthropic;

  return {
    id,
    async getStatus() {
      const key = getApiKey();
      const available = Boolean(key && key.length > 0);
      return {
        id,
        label,
        available,
        reason: available
          ? undefined
          : `Set ${
              chatProvider === "openai" ? "OPENAI_API_KEY" : "ANTHROPIC_API_KEY"
            } or add a BYOK key in Settings.`,
        selectedModel: available ? modelId : null,
        models: []
      };
    },
    async extract(input) {
      const apiKey = getApiKey();
      if (!apiKey) {
        throw new Error(
          `No API key configured for cloud note processing (set ${
            chatProvider === "openai" ? "OPENAI_API_KEY" : "ANTHROPIC_API_KEY"
          } or a BYOK key in Settings).`
        );
      }
      const { content } =
        chatProvider === "openai"
          ? await extractOpenAi(apiKey, input)
          : await extractAnthropic(apiKey, input);

      const parsed = parseExtractionResponseJson(content, {
        index: input.index,
        sourceType: input.sourceType,
        sourcePath: input.sourcePath,
        sessionPriorSlugs: input.sessionPriorNoteSlugs
      });

      if (!parsed.value) {
        throw new ExtractionValidationError(
          parsed.issues[0]?.message ?? "Cloud note processing returned an invalid response.",
          parsed.issues.map((issue) => `${issue.path}: ${issue.message}`)
        );
      }

      return {
        response: parsed.value,
        provider: id,
        model: modelId
      };
    }
  };
}
