import {
  noteBodyMarkdownSystemPrompt,
  noteInsertionMarkdownSystemPrompt
} from "../../../supabase/functions/_shared/prompts";
import { normalizeTitleKey } from "../../../shared/extraction/wikiLinks";
import { runEmbeddedChatPrompt } from "./embeddedCompletion";
import { isEmbeddedModelAvailable } from "./embeddedModelPath";

const maxInsertionChars = 14_000;
const maxPromptNoteChars = 6_000;
const maxSectionExcerptChars = 3_500;
const maxAssistantContextChars = 4_000;

export function wantsAiRichMarkdownInstruction(content: string): boolean {
  const text = content.trim();
  if (text.length === 0) {
    return false;
  }

  if (/\n/.test(text)) {
    return true;
  }

  if (text.length > 220) {
    return true;
  }

  if (/\|\s*[^|\n]+\s*\|/.test(text)) {
    return true;
  }

  return /\b(?:table|tables|tabular|grid|rows?|columns?|bold|italic|emphasi[sz]e|strikethrough|highlight|color|colour|red|blue|green|amber|purple|orange|font|heading|subheading|markdown|format(?:ted|ting)?|bullet|numbered|checklist|task\s*list|blockquote|code\s*block|fence|pipe|row|cell|align|span|style|size|larger|smaller|indent)\b/i.test(
    text
  );
}

export function stripLeadingMarkdownFence(text: string): string {
  let t = text.trim();
  const fence = /^```(?:markdown|md)?\s*\n?([\s\S]*?)\n?```\s*$/i.exec(t);
  if (fence?.[1]) {
    return fence[1].trim();
  }

  if (t.startsWith("```")) {
    t = t.replace(/^```(?:markdown|md)?\s*\n?/i, "");
    t = t.replace(/\n?```\s*$/i, "");
  }

  return t.trim();
}

function truncate(input: string, max: number): string {
  if (input.length <= max) {
    return input;
  }

  return `${input.slice(0, max)}\n\n…`;
}

/**
 * Returns lines belonging to the first section whose heading matches {@code sectionHint}.
 */
export function extractMarkdownSectionExcerpt(
  body: string,
  sectionHint: string,
  maxChars: number
): string | null {
  const hintKey = normalizeTitleKey(sectionHint);
  const lines = body.split(/\r?\n/);
  let headingIndex = -1;
  let headingLevel = 1;

  for (let index = 0; index < lines.length; index += 1) {
    const match = /^(#{1,6})\s+(.+)$/.exec(lines[index] ?? "");
    const hashes = match?.[1];
    const rawTitle = match?.[2];
    if (!hashes || rawTitle === undefined) {
      continue;
    }

    const titleKey = normalizeTitleKey(rawTitle.trim());
    const hintMatchesTitle =
      titleKey === hintKey ||
      (hintKey.length >= 3 && titleKey.includes(hintKey)) ||
      (hintKey.length >= 3 && hintKey.includes(titleKey));

    if (hintMatchesTitle) {
      headingIndex = index;
      headingLevel = hashes.length;
      break;
    }
  }

  if (headingIndex === -1) {
    return null;
  }

  let endIndex = lines.length;
  for (let index = headingIndex + 1; index < lines.length; index += 1) {
    const nextHeading = /^(#{1,6})\s/.exec(lines[index] ?? "");
    const nextHashes = nextHeading?.[1];
    if (nextHashes && nextHashes.length <= headingLevel) {
      endIndex = index;
      break;
    }
  }

  const slice = lines.slice(headingIndex, endIndex).join("\n").trim();
  return truncate(slice, maxChars);
}

function buildInsertionUserPrompt(input: {
  targetTitle: string;
  userMessage: string;
  noteExcerpt: string;
  sectionExcerpt: string | null;
  assistantExcerpt: string | null;
}): string {
  return [
    "## Target note",
    `Title: ${input.targetTitle}`,
    "",
    "## User request (follow literally)",
    input.userMessage.trim(),
    "",
    "## Existing note excerpt (for tone and facts; do not repeat verbatim unless asked)",
    input.noteExcerpt.trim().length > 0 ? input.noteExcerpt.trim() : "(empty or unavailable)",
    "",
    "## Matching section excerpt (when applicable)",
    input.sectionExcerpt ?? "(not targeting a specific heading — produce a cohesive block to append in the chosen area)",
    "",
    "## Recent assistant message (optional context for “this”, “that”, or details)",
    input.assistantExcerpt ?? "(none)",
    "",
    "Write ONLY the markdown fragment to insert."
  ].join("\n");
}

function buildNewNoteBodyUserPrompt(input: {
  targetTitle: string;
  userMessage: string;
  assistantExcerpt: string | null;
}): string {
  return [
    "## New note title",
    input.targetTitle,
    "",
    "## User request",
    input.userMessage.trim(),
    "",
    "## Recent assistant draft (use or reshape when it matches the request)",
    input.assistantExcerpt ?? "(none)",
    "",
    "Write ONLY the full markdown body for the new note (no front matter)."
  ].join("\n");
}

function clampInsertionMarkdown(raw: string): string {
  const stripped = stripLeadingMarkdownFence(raw);
  if (stripped.length <= maxInsertionChars) {
    return stripped;
  }

  return `${stripped.slice(0, maxInsertionChars)}\n\n_…trimmed for length in preview_`;
}

export async function tryGenerateNoteInsertionMarkdown(input: {
  targetTitle: string;
  userMessage: string;
  beforeMarkdown: string;
  sectionHint: string | null;
  previousAssistantContent: string | null;
}): Promise<string | null> {
  if (!wantsAiRichMarkdownInstruction(input.userMessage)) {
    return null;
  }

  if (!(await isEmbeddedModelAvailable())) {
    return null;
  }

  const noteExcerpt = truncate(input.beforeMarkdown.trim(), maxPromptNoteChars);
  const sectionExcerpt = input.sectionHint
    ? extractMarkdownSectionExcerpt(input.beforeMarkdown, input.sectionHint, maxSectionExcerptChars)
    : null;
  const assistantExcerpt = input.previousAssistantContent
    ? truncate(input.previousAssistantContent.trim(), maxAssistantContextChars)
    : null;

  try {
    const raw = await runEmbeddedChatPrompt({
      systemPrompt: noteInsertionMarkdownSystemPrompt,
      userPrompt: buildInsertionUserPrompt({
        targetTitle: input.targetTitle,
        userMessage: input.userMessage,
        noteExcerpt,
        sectionExcerpt,
        assistantExcerpt
      }),
      maxTokens: 2048,
      temperature: 0.35
    });

    return clampInsertionMarkdown(raw);
  } catch {
    return null;
  }
}

export async function tryGenerateNewNoteBodyMarkdown(input: {
  targetTitle: string;
  userMessage: string;
  previousAssistantContent: string | null;
}): Promise<string | null> {
  if (!wantsAiRichMarkdownInstruction(input.userMessage)) {
    return null;
  }

  if (!(await isEmbeddedModelAvailable())) {
    return null;
  }

  const assistantExcerpt = input.previousAssistantContent
    ? truncate(input.previousAssistantContent.trim(), maxAssistantContextChars)
    : null;

  try {
    const raw = await runEmbeddedChatPrompt({
      systemPrompt: noteBodyMarkdownSystemPrompt,
      userPrompt: buildNewNoteBodyUserPrompt({
        targetTitle: input.targetTitle,
        userMessage: input.userMessage,
        assistantExcerpt
      }),
      maxTokens: 2560,
      temperature: 0.35
    });

    return clampInsertionMarkdown(raw);
  } catch {
    return null;
  }
}
