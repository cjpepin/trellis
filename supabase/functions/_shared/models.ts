import { buildChatSystemPrompt, type ChatPromptReference } from "./prompts.ts";
import {
  getChatModelLabel,
  getChatModelProvider,
  type ChatModel
} from "./chat-models.ts";

export interface ChatImagePart {
  mimeType: string;
  dataBase64: string;
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  imageParts?: ChatImagePart[];
}

export interface ChatReference extends ChatPromptReference {}

class ChatGenerationError extends Error {}

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

function toOpenAiApiMessage(message: ChatMessage): Record<string, unknown> {
  if (message.role === "assistant") {
    return { role: "assistant", content: message.content };
  }

  if (!message.imageParts?.length) {
    return { role: "user", content: message.content };
  }

  return {
    role: "user",
    content: [
      { type: "text", text: message.content },
      ...message.imageParts.map((part) => ({
        type: "image_url",
        image_url: {
          url: `data:${part.mimeType};base64,${part.dataBase64}`
        }
      }))
    ]
  };
}

function toAnthropicApiMessage(message: ChatMessage): Record<string, unknown> {
  if (message.role === "assistant") {
    return { role: "assistant", content: message.content };
  }

  if (!message.imageParts?.length) {
    return { role: "user", content: message.content };
  }

  return {
    role: "user",
    content: [
      ...message.imageParts.map((part) => ({
        type: "image",
        source: {
          type: "base64",
          media_type: part.mimeType,
          data: part.dataBase64
        }
      })),
      { type: "text", text: message.content }
    ]
  };
}

async function* streamOpenAiChatTokens(
  messages: ChatMessage[],
  references: ChatReference[],
  model: ChatModel,
  apiKeyOverride?: string
): AsyncGenerator<string> {
  const apiKey = apiKeyOverride ?? readEnvironmentValue("OPENAI_API_KEY");
  const modelLabel = getChatModelLabel(model);

  if (!apiKey) {
    throw new ChatGenerationError(
      `${modelLabel} is selected, but OPENAI_API_KEY is not configured for the chat Edge Function.`
    );
  }

  let response: Response;

  try {
    response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model,
        stream: true,
        messages: [
          {
            role: "system",
            content: buildChatSystemPrompt(references)
          },
          ...messages.map(toOpenAiApiMessage)
        ]
      })
    });
  } catch {
    throw new ChatGenerationError(
      "OpenAI chat request failed before a response was returned. Check the provider configuration and try again."
    );
  }

  if (!response.ok) {
    const providerMessage = await readProviderError(response);
    throw new ChatGenerationError(
      providerMessage
        ? `OpenAI chat request failed: ${providerMessage}`
        : "OpenAI chat request failed."
    );
  }

  const body = response.body;
  if (!body) {
    throw new ChatGenerationError("OpenAI returned an empty stream.");
  }

  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) {
          continue;
        }
        const data = trimmed.slice(5).trim();
        if (data === "[DONE]") {
          continue;
        }
        try {
          const json = JSON.parse(data) as {
            choices?: Array<{ delta?: { content?: string | null } }>;
          };
          const piece = json.choices?.[0]?.delta?.content;
          if (typeof piece === "string" && piece.length > 0) {
            yield piece;
          }
        } catch {
          // Ignore malformed stream chunks
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

async function* streamAnthropicChatTokens(
  messages: ChatMessage[],
  references: ChatReference[],
  model: ChatModel,
  apiKeyOverride?: string
): AsyncGenerator<string> {
  const apiKey = apiKeyOverride ?? readEnvironmentValue("ANTHROPIC_API_KEY");
  const modelLabel = getChatModelLabel(model);

  if (!apiKey) {
    throw new ChatGenerationError(
      `${modelLabel} is selected, but ANTHROPIC_API_KEY is not configured for the chat Edge Function.`
    );
  }

  let response: Response;

  try {
    response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model,
        max_tokens: 4096,
        stream: true,
        system: buildChatSystemPrompt(references),
        messages: messages.map(toAnthropicApiMessage)
      })
    });
  } catch {
    throw new ChatGenerationError(
      "Anthropic chat request failed before a response was returned. Check the provider configuration and try again."
    );
  }

  if (!response.ok) {
    const providerMessage = await readProviderError(response);
    throw new ChatGenerationError(
      providerMessage
        ? `Anthropic chat request failed: ${providerMessage}`
        : "Anthropic chat request failed."
    );
  }

  const body = response.body;
  if (!body) {
    throw new ChatGenerationError("Anthropic returned an empty stream.");
  }

  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      buffer += decoder.decode(value, { stream: true });
      const blocks = buffer.split("\n\n");
      buffer = blocks.pop() ?? "";

      for (const block of blocks) {
        const lines = block.split("\n").filter((l) => l.length > 0);
        let dataLine = "";

        for (const line of lines) {
          if (line.startsWith("data:")) {
            const raw = line.slice(5);
            dataLine += (dataLine ? "\n" : "") + (raw.startsWith(" ") ? raw.slice(1) : raw);
          }
        }

        if (dataLine.length === 0) {
          continue;
        }

        try {
          const payload = JSON.parse(dataLine) as Record<string, unknown>;
          if (payload.type === "content_block_delta") {
            const delta = payload.delta as Record<string, unknown> | undefined;
            if (delta?.type === "text_delta" && typeof delta.text === "string" && delta.text.length > 0) {
              yield delta.text;
            }
          }
        } catch {
          // Ignore malformed stream chunks
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
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

    if (errorValue && typeof errorValue === "object") {
      const nestedMessage = (errorValue as Record<string, unknown>).message;

      if (typeof nestedMessage === "string" && nestedMessage.length > 0) {
        return nestedMessage;
      }
    }
  } catch {
    return text.trim();
  }

  return text.trim();
}

export async function* streamChatReply(
  messages: ChatMessage[],
  model: ChatModel,
  references: ChatReference[] = [],
  options?: {
    providerApiKey?: string;
  }
): AsyncGenerator<string> {
  if (getChatModelProvider(model) === "openai") {
    yield* streamOpenAiChatTokens(messages, references, model, options?.providerApiKey);
    return;
  }
  yield* streamAnthropicChatTokens(messages, references, model, options?.providerApiKey);
}
