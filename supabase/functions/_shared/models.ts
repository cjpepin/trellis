import {
  buildChatSystemPrompt,
  extractionPrompt,
  sessionTitlePrompt,
  type ChatPromptReference
} from "./prompts.ts";
import {
  getChatModelLabel,
  getChatModelProvider,
  type ChatModel
} from "./chat-models.ts";

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface ChatReference extends ChatPromptReference {}

export interface ExtractionIndexNote {
  slug: string;
  title: string;
  tags: string[];
  isPlaceholder?: boolean;
}

export interface ExtractionUpdate {
  file: string;
  action: "create" | "update" | "append";
  title: string;
  content: string;
  tags: string[];
  type: "concept" | "entity" | "source-summary" | "synthesis";
  linkedTo: string[];
  sources?: number;
  url?: string;
}

export interface ExtractionPayload {
  updates: ExtractionUpdate[];
  sessionTitle: string;
}

class ChatGenerationError extends Error {}

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

function deriveSessionTitle(messages: ChatMessage[]): string {
  const lastUserMessage = [...messages]
    .reverse()
    .find((message) => message.role === "user")?.content;

  if (!lastUserMessage) {
    return "New Conversation";
  }

  const keywords = extractKeywords(lastUserMessage);

  if (keywords.length === 0) {
    return titleCase(lastUserMessage.split(/\s+/).slice(0, 6).join(" "));
  }

  return titleCase(keywords.slice(0, 3).join(" "));
}

async function callOpenAi(
  messages: ChatMessage[],
  references: ChatReference[],
  model: ChatModel
): Promise<string> {
  const apiKey = Deno.env.get("OPENAI_API_KEY");
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
          ...messages
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
  model: ChatModel
): Promise<string> {
  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
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
        messages
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
  references: ChatReference[] = []
): Promise<{
  text: string;
  sessionTitle: string;
  tokenCount: number;
}> {
  const text =
    getChatModelProvider(model) === "openai"
      ? await callOpenAi(messages, references, model)
      : await callAnthropic(messages, references, model);

  return {
    text,
    sessionTitle: deriveSessionTitle(messages),
    tokenCount: Math.ceil(text.length / 4)
  };
}

async function callExtractionLLM(
  systemPrompt: string,
  userMessage: string
): Promise<string | null> {
  const openAiKey = Deno.env.get("OPENAI_API_KEY");

  if (openAiKey) {
    const model = Deno.env.get("OPENAI_EXTRACTION_MODEL") ?? "gpt-4o-mini";

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

  const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY");
  const anthropicModel = Deno.env.get("ANTHROPIC_EXTRACTION_MODEL") ??
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
  try {
    const cleaned = raw
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/i, "")
      .trim();

    const parsed = JSON.parse(cleaned) as Record<string, unknown>;

    if (!Array.isArray(parsed.updates)) {
      return null;
    }

    const indexBySlug = new Map(index.map((note) => [note.slug, note]));
    const existingNoteSlugs = new Set(
      index.filter((note) => !note.isPlaceholder).map((note) => note.slug)
    );

    const updates: ExtractionUpdate[] = (parsed.updates as Record<string, unknown>[])
      .filter((u) =>
        typeof u.file === "string" &&
        typeof u.title === "string" &&
        typeof u.content === "string"
      )
      .map((u) => {
        const file = String(u.file).endsWith(".md")
          ? String(u.file)
          : `${String(u.file)}.md`;
        const slug = file.replace(/\.md$/i, "");
        const matchedIndexNote = indexBySlug.get(slug);
        const action = existingNoteSlugs.has(slug)
          ? (u.action === "append" ? "append" : "update")
          : (matchedIndexNote ? "create" : "create");

        return {
          file,
          action,
          title: matchedIndexNote?.title ?? String(u.title),
          content: String(u.content),
          tags: Array.isArray(u.tags)
            ? (u.tags as unknown[]).filter((t): t is string => typeof t === "string").slice(0, 6)
            : [],
          type: (["concept", "entity", "source-summary", "synthesis"].includes(String(u.type))
            ? String(u.type)
            : "concept") as ExtractionUpdate["type"],
          linkedTo: Array.isArray(u.linkedTo)
            ? (u.linkedTo as unknown[]).filter((l): l is string => typeof l === "string")
            : [],
          sources: input.sourceType ? 1 : 0,
          url: input.sourceType === "web" ? input.sourcePath : undefined
        };
      });

    const sessionTitle = typeof parsed.sessionTitle === "string"
      ? parsed.sessionTitle.slice(0, 60)
      : "Untitled Session";

    return { updates, sessionTitle };
  } catch {
    return null;
  }
}

function extractKnowledgeHeuristic(input: {
  transcript: ChatMessage[];
  index: ExtractionIndexNote[];
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
    .map((note) => `${note.slug}.md`);
  const bullets = buildBulletPoints(corpus);
  const noteType = input.sourceType ? "source-summary" : "concept";
  const summary = splitSentences(corpus).slice(0, 2).join(" ");
  const titleForLinks = linkedTo
    .map((file) => file.replace(/\.md$/i, "").split("-").map(titleCase).join(" "))
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
      file: `${slug}.md`,
      action: existing ? "append" : "create",
      title: primaryTitle,
      content: primaryContent,
      tags: keywords.slice(0, 4),
      type: noteType,
      linkedTo,
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
  sourceType?: "pdf" | "web" | "text";
  sourceTitle?: string;
  sourcePath?: string;
  sourceContent?: string;
}): Promise<ExtractionPayload> {
  const corpus =
    input.sourceContent ||
    input.transcript
      .map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`)
      .join("\n\n");

  if (!shouldExtractKnowledge(corpus, input.sourceType)) {
    return { updates: [], sessionTitle: deriveSessionTitle(input.transcript) };
  }

  const indexBlock = input.index.length > 0
    ? input.index
        .map(
          (n) =>
            `- ${n.title} (${n.slug}.md) [${n.tags.join(", ")}]${n.isPlaceholder ? " {placeholder target}" : ""}`
        )
        .join("\n")
    : "(empty wiki)";

  const userMessage = [
    "## Current Wiki Index",
    indexBlock,
    "",
    input.sourceType ? `## Source (${input.sourceType})` : "## Conversation Transcript",
    input.sourceTitle ? `Title: ${input.sourceTitle}` : "",
    input.sourcePath ? `Path: ${input.sourcePath}` : "",
    "",
    corpus.slice(0, 12000)
  ].filter((line) => line !== undefined).join("\n");

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

  return extractKnowledgeHeuristic(input);
}
