import {
  buildChatSystemPrompt,
  extractionPrompt,
  type ChatPromptReference
} from "./prompts.ts";
import {
  getChatModelLabel,
  getChatModelProvider,
  type ChatModel
} from "./chat-models.ts";
import {
  buildExtractionCorpus,
  buildExtractionUserMessage
} from "../../../shared/extraction/buildPrompt.ts";
import {
  extractionFeatureFlagNames,
  parseBooleanFlag
} from "../../../shared/extraction/config.ts";
import {
  parseExtractionResponseJson
} from "../../../shared/extraction/validate.ts";
import type {
  ExtractionContextNote,
  ExtractionIndexEntry as ExtractionIndexNote,
  ExtractionResponse as ExtractionPayload,
  ExtractionUpdate
} from "../../../shared/extraction/contracts.ts";
import { deriveSessionTitle } from "../../../shared/chat/deriveSessionTitle.ts";

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

function isHeuristicExtractionFallbackEnabled(): boolean {
  return parseBooleanFlag(
    readEnvironmentValue(extractionFeatureFlagNames.heuristicFallback),
    true
  );
}

const stopWords = new Set([
  "about",
  "after",
  "again",
  "being",
  "could",
  "from",
  "have",
  "into",
  "just",
  "more",
  "than",
  "that",
  "their",
  "there",
  "these",
  "they",
  "this",
  "what",
  "with",
  "would"
]);

function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function titleCase(value: string): string {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function tokenizeIndexText(value: string): string[] {
  return value
    .toLowerCase()
    .match(/[a-z0-9][a-z0-9-]{1,}/g) ?? [];
}

function scoreIndexNoteMatch(
  note: ExtractionIndexNote,
  corpusLower: string,
  keywords: string[]
): number {
  const tokens = new Set([
    ...tokenizeIndexText(note.title),
    ...tokenizeIndexText(note.slug.replace(/-/g, " ")),
    ...note.tags.flatMap((tag) => tokenizeIndexText(tag))
  ]);
  let score = note.isPlaceholder ? 2 : 3;

  if (corpusLower.includes(note.title.toLowerCase())) {
    score += 6;
  }

  if (corpusLower.includes(note.slug.replace(/-/g, " "))) {
    score += 4;
  }

  for (const token of tokens) {
    if (stopWords.has(token) || token.length < 3) {
      continue;
    }

    if (keywords.includes(token)) {
      score += 2;
    }

    if (corpusLower.includes(token)) {
      score += 1;
    }
  }

  return score;
}

function findPreferredIndexTarget(
  index: ExtractionIndexNote[],
  corpus: string,
  keywords: string[],
  preferredSlug?: string
): ExtractionIndexNote | null {
  if (preferredSlug) {
    const exactSlugMatch = index.find((note) => note.slug === preferredSlug);

    if (exactSlugMatch) {
      return exactSlugMatch;
    }
  }

  const corpusLower = corpus.toLowerCase();
  let bestMatch: ExtractionIndexNote | null = null;
  let bestScore = 0;

  for (const note of index) {
    const score = scoreIndexNoteMatch(note, corpusLower, keywords);

    if (score > bestScore) {
      bestScore = score;
      bestMatch = note;
    }
  }

  return bestScore >= 6 ? bestMatch : null;
}

function splitSentences(text: string): string[] {
  return text
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

function extractKeywords(text: string): string[] {
  const counts = new Map<string, number>();

  for (const token of text.toLowerCase().match(/[a-z][a-z-]{3,}/g) ?? []) {
    if (stopWords.has(token)) {
      continue;
    }

    counts.set(token, (counts.get(token) ?? 0) + 1);
  }

  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1])
    .slice(0, 6)
    .map(([token]) => token);
}

function buildBulletPoints(text: string): string[] {
  return splitSentences(text).slice(0, 4);
}

function shouldExtractKnowledge(corpus: string, sourceType?: "pdf" | "web" | "text"): boolean {
  if (sourceType) {
    return true;
  }

  const normalized = corpus.trim();
  const sentences = splitSentences(normalized);
  const keywords = extractKeywords(normalized);
  const hasStructure = /(^|\n)\s*(?:[-*]\s|#{1,3}\s|\d+\.\s)/m.test(normalized);
  const hasDecisionSignal =
    /\b(decide|decision|plan|next step|tradeoff|approach|architecture|policy|workflow|implement|build|refactor|fix|learned|insight)\b/i
      .test(normalized);

  if (normalized.length < 120 && !hasStructure) {
    return false;
  }

  if (sentences.length < 2 && !hasDecisionSignal) {
    return false;
  }

  if (keywords.length < 2) {
    return false;
  }

  return true;
}

function isTemplateCreationRequest(corpus: string): boolean {
  return /\b(?:reusable\s+)?(?:trellis\s+)?template\b/i.test(corpus) &&
    /\b(create|make|draft|build|design|save)\b/i.test(corpus);
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

async function callOpenAi(
  messages: ChatMessage[],
  references: ChatReference[],
  model: ChatModel,
  apiKeyOverride?: string
): Promise<string> {
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

  const payload = await response.json();
  const content = (payload as { choices?: Array<{ message?: { content?: string } }> }).choices?.[0]
    ?.message?.content;

  if (typeof content !== "string" || content.trim().length === 0) {
    throw new ChatGenerationError("OpenAI returned an empty response.");
  }

  return content.trim();
}

async function callAnthropic(
  messages: ChatMessage[],
  references: ChatReference[],
  model: ChatModel,
  apiKeyOverride?: string
): Promise<string> {
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
        max_tokens: 1024,
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

  const payload = await response.json();
  const content = extractAnthropicText(payload);

  if (!content) {
    throw new ChatGenerationError("Anthropic returned an empty response.");
  }

  return content;
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

function extractAnthropicText(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const content = (payload as { content?: unknown }).content;

  if (!Array.isArray(content)) {
    return null;
  }

  const parts = content
    .filter(
      (part): part is { type: string; text: string } =>
        typeof part === "object" &&
        part !== null &&
        (part as { type?: unknown }).type === "text" &&
        typeof (part as { text?: unknown }).text === "string"
    )
    .map((part) => part.text.trim())
    .filter((part) => part.length > 0);

  if (parts.length === 0) {
    return null;
  }

  return parts.join("\n\n");
}

export async function generateChatReply(
  messages: ChatMessage[],
  model: ChatModel,
  references: ChatReference[] = [],
  options?: {
    providerApiKey?: string;
  }
): Promise<{
  text: string;
  sessionTitle: string;
  tokenCount: number;
}> {
  const text =
    getChatModelProvider(model) === "openai"
      ? await callOpenAi(messages, references, model, options?.providerApiKey)
      : await callAnthropic(messages, references, model, options?.providerApiKey);

  return {
    text,
    sessionTitle: deriveSessionTitle(messages, { assistantReply: text }),
    tokenCount: Math.ceil(text.length / 4)
  };
}

async function callExtractionLLM(
  systemPrompt: string,
  userMessage: string
): Promise<string | null> {
  const openAiKey = readEnvironmentValue("OPENAI_API_KEY");

  if (openAiKey) {
    const model = readEnvironmentValue("OPENAI_EXTRACTION_MODEL") ?? "gpt-4o-mini";

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${openAiKey}`
      },
      body: JSON.stringify({
        model,
        temperature: 0.3,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userMessage }
        ]
      })
    });

    if (response.ok) {
      const payload = await response.json();
      return payload.choices?.[0]?.message?.content ?? null;
    }
  }

  const anthropicKey = readEnvironmentValue("ANTHROPIC_API_KEY");
  const anthropicModel = readEnvironmentValue("ANTHROPIC_EXTRACTION_MODEL") ??
    "claude-3-5-haiku-latest";

  if (anthropicKey && anthropicModel) {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": anthropicKey,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: anthropicModel,
        max_tokens: 2048,
        temperature: 0.3,
        system: systemPrompt,
        messages: [{ role: "user", content: userMessage }]
      })
    });

    if (response.ok) {
      const payload = await response.json();
      return payload.content?.[0]?.text ?? null;
    }
  }

  return null;
}

function parseExtractionResponse(
  raw: string,
  index: ExtractionIndexNote[],
  input: {
    sourceType?: string;
    sourcePath?: string;
  }
): ExtractionPayload | null {
  return parseExtractionResponseJson(raw, {
    index,
    sourceType:
      input.sourceType === "pdf" || input.sourceType === "text" || input.sourceType === "web"
        ? input.sourceType
        : undefined,
    sourcePath: input.sourcePath
  }).value;
}

export function extractKnowledgeHeuristic(input: {
  transcript: ChatMessage[];
  index: ExtractionIndexNote[];
  relatedNotes?: ExtractionContextNote[];
  sourceType?: "pdf" | "web" | "text";
  sourceTitle?: string;
  sourcePath?: string;
  sourceContent?: string;
}): ExtractionPayload {
  const corpus =
    input.sourceContent ||
    input.transcript
      .map((message) => `${message.role === "user" ? "User" : "Assistant"}: ${message.content}`)
      .join("\n\n");

  const keywords = extractKeywords(corpus);
  const preferredTarget = findPreferredIndexTarget(
    input.index,
    corpus,
    keywords,
    input.sourceTitle ? slugify(input.sourceTitle) : undefined
  );
  const templateCreationRequest = isTemplateCreationRequest(corpus);
  const primaryTitle = preferredTarget?.title ??
    (input.sourceTitle
      ? input.sourceTitle
      : keywords.length > 0
        ? titleCase(keywords.slice(0, 2).join(" "))
        : deriveSessionTitle(input.transcript));
  const slug = preferredTarget?.slug ?? slugify(primaryTitle);
  const existing = preferredTarget
    ? !preferredTarget.isPlaceholder
    : input.index.find((note) => note.slug === slug && !note.isPlaceholder);
  const linkedTo = input.index
    .filter((note) =>
      note.slug !== slug &&
      (
        note.tags.some((tag) => keywords.includes(tag.toLowerCase())) ||
        keywords.some((keyword) => note.title.toLowerCase().includes(keyword))
      )
    )
    .slice(0, 4)
    .map((note) => note.title);
  const bullets = buildBulletPoints(corpus);
  const noteType = input.sourceType ? "source-summary" : "concept";
  const summary = splitSentences(corpus).slice(0, 2).join(" ");
  const tags = [
    ...new Set([
      ...keywords.filter((keyword) => keyword !== "template"),
      ...(templateCreationRequest ? ["template"] : [])
    ])
  ].slice(0, 4);
  const titleForLinks = linkedTo
    .map((title) => `- [[${title}]]`)
    .join("\n");

  const primaryContent = [
    existing
      ? "## New Context"
      : `# ${primaryTitle}`,
    existing ? "" : "",
    existing ? summary || corpus.slice(0, 280) : "## Summary",
    existing ? "" : "",
    existing ? "" : summary || corpus.slice(0, 400),
    "## Key Points",
    "",
    ...bullets.map((bullet) => `- ${bullet}`),
    linkedTo.length > 0 ? "" : "",
    linkedTo.length > 0 ? "## Connected Notes" : "",
    linkedTo.length > 0 ? titleForLinks : "",
    input.sourcePath ? "" : "",
    input.sourcePath ? `Source: ${input.sourcePath}` : ""
  ]
    .filter(Boolean)
    .join("\n");

  const updates: ExtractionUpdate[] = [
    {
      operation: existing ? "append" : "create",
      targetSlug: slug,
      targetTitle: primaryTitle,
      targetType: noteType,
      summary: summary || primaryTitle,
      body: primaryContent,
      tags,
      links: linkedTo,
      evidence: [
        {
          kind: input.sourceType ? "source" : "transcript",
          ref: input.sourcePath ?? (input.sourceType ?? "transcript"),
          summary: summary || primaryTitle
        }
      ],
      confidence: existing ? 0.66 : 0.61,
      sources: input.sourceType ? 1 : 0,
      url: input.sourceType === "web" ? input.sourcePath : undefined
    }
  ];

  return {
    updates,
    sessionTitle: deriveSessionTitle(input.transcript)
  };
}

export async function extractKnowledge(input: {
  transcript: ChatMessage[];
  index: ExtractionIndexNote[];
  relatedNotes?: ExtractionContextNote[];
  sourceType?: "pdf" | "web" | "text";
  sourceTitle?: string;
  sourcePath?: string;
  sourceContent?: string;
}, options?: {
  allowHeuristicFallback?: boolean;
}): Promise<ExtractionPayload> {
  const corpus = buildExtractionCorpus(input);

  if (!shouldExtractKnowledge(corpus, input.sourceType)) {
    return { updates: [], sessionTitle: deriveSessionTitle(input.transcript) };
  }

  const userMessage = buildExtractionUserMessage(input);

  const llmResult = await callExtractionLLM(extractionPrompt, userMessage);

  if (llmResult) {
    const parsed = parseExtractionResponse(llmResult, input.index, {
      sourceType: input.sourceType,
      sourcePath: input.sourcePath
    });

    if (parsed && parsed.updates.length > 0) {
      return parsed;
    }

    if (parsed && parsed.updates.length === 0) {
      return {
        updates: [],
        sessionTitle: parsed.sessionTitle || deriveSessionTitle(input.transcript)
      };
    }
  }

  if (options?.allowHeuristicFallback ?? isHeuristicExtractionFallbackEnabled()) {
    return extractKnowledgeHeuristic(input);
  }

  throw new Error(
    "Cloud extraction returned no valid structured output and heuristic fallback is disabled."
  );
}
