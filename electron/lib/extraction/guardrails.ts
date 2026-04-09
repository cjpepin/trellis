import type {
  ExtractionIndexEntry,
  ExtractionUpdate
} from "../../../shared/extraction/contracts";
import { extractionThresholds } from "../../../shared/extraction/config";
import {
  extractWikiLinkTitles,
  normalizeTitleKey
} from "../../../shared/extraction/wikiLinks";
import type { WikiNote } from "../../ipc/types";

interface PreparedExtractionWrite {
  slug: string;
  title: string;
  content: string;
  tags: string[];
  type: ExtractionUpdate["targetType"];
  sources: number;
  url?: string;
  operation: "create" | "append" | "rewrite";
}

interface PrepareExtractionWriteInput {
  update: ExtractionUpdate;
  existingNote: Pick<WikiNote, "title" | "content" | "tags" | "sources" | "type"> | null;
  index: ExtractionIndexEntry[];
}

const connectedNotesHeading = "## Connected Notes";
const transcriptLikeLinePattern =
  /^\s*(?:[-*+]\s+)?(?:user|assistant|human|ai|me|you|q|a)\s*:\s+/i;
const headingPattern = /^(#{1,6})\s+(.+?)\s*$/;

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}

function normalizeTagList(tags: string[]): string[] {
  return uniqueStrings(
    tags
      .map((tag) => tag.trim().toLowerCase())
      .filter((tag) => tag.length > 0)
  )
    .sort((left, right) => left.localeCompare(right))
    .slice(0, extractionThresholds.maxTagsPerNote);
}

function buildIndexLookups(index: ExtractionIndexEntry[]) {
  const titleByKey = new Map<string, string>();

  for (const note of index) {
    titleByKey.set(normalizeTitleKey(note.title), note.title);
  }

  return {
    titleByKey
  };
}

function normalizeBulletLines(body: string): string {
  return body.replace(/^\s*[*+•]\s+/gm, "- ");
}

function stripTranscriptLikeLines(body: string): string {
  return body
    .split("\n")
    .filter((line) => !transcriptLikeLinePattern.test(line))
    .join("\n");
}

function stripRedundantTitleHeading(body: string, title: string): string {
  const lines = body.split("\n");
  const firstNonEmptyIndex = lines.findIndex((line) => line.trim().length > 0);

  if (firstNonEmptyIndex === -1) {
    return body.trim();
  }

  const line = lines[firstNonEmptyIndex] ?? "";
  const match = line.match(headingPattern);

  if (!match) {
    return body.trim();
  }

  const headingTitle = normalizeTitleKey(match[2] ?? "");

  if (headingTitle !== normalizeTitleKey(title)) {
    return body.trim();
  }

  lines.splice(firstNonEmptyIndex, 1);
  return lines.join("\n").trim();
}

function normalizeBodyLinks(body: string, index: ExtractionIndexEntry[]): {
  body: string;
  links: string[];
} {
  const lookups = buildIndexLookups(index);
  const resolvedLinks: string[] = [];

  const normalizedBody = body.replace(/\[\[([^[\]]+)\]\]/g, (_match, rawTitle: string) => {
    const trimmedTitle = rawTitle.trim();
    const matchedTitle = lookups.titleByKey.get(normalizeTitleKey(trimmedTitle));

    if (!matchedTitle) {
      return trimmedTitle;
    }

    resolvedLinks.push(matchedTitle);
    return `[[${matchedTitle}]]`;
  });

  return {
    body: normalizedBody,
    links: uniqueStrings(resolvedLinks)
  };
}

function normalizeLinkTitles(links: string[], index: ExtractionIndexEntry[]): string[] {
  const lookups = buildIndexLookups(index);

  return uniqueStrings(
    links
      .map((link) => lookups.titleByKey.get(normalizeTitleKey(link)) ?? null)
      .filter((link): link is string => Boolean(link))
  );
}

function dedupeParagraphsAgainstExisting(existingContent: string, nextBody: string): string {
  const existingParagraphKeys = new Set(
    existingContent
      .split(/\n{2,}/)
      .map((paragraph) => paragraph.replace(/\s+/g, " ").trim().toLowerCase())
      .filter((paragraph) => paragraph.length > 0)
  );

  return nextBody
    .split(/\n{2,}/)
    .filter((paragraph) => {
      const key = paragraph.replace(/\s+/g, " ").trim().toLowerCase();

      if (key.length === 0) {
        return false;
      }

      return !existingParagraphKeys.has(key);
    })
    .join("\n\n")
    .trim();
}

function demoteDuplicateHeadings(
  body: string,
  existingContent: string,
  noteTitle: string
): string {
  const seenHeadingKeys = new Set<string>();

  for (const line of existingContent.split("\n")) {
    const match = line.match(headingPattern);

    if (match) {
      seenHeadingKeys.add(normalizeTitleKey(match[2] ?? ""));
    }
  }

  return body
    .split("\n")
    .map((line) => {
      const match = line.match(headingPattern);

      if (!match) {
        return line;
      }

      const headingTitle = (match[2] ?? "").trim();
      const headingKey = normalizeTitleKey(headingTitle);
      const isDuplicate =
        seenHeadingKeys.has(headingKey) || headingKey === normalizeTitleKey(noteTitle);

      seenHeadingKeys.add(headingKey);

      if (!isDuplicate) {
        return `## ${headingTitle}`;
      }

      return `**${headingTitle}**`;
    })
    .join("\n");
}

function ensureConnectedNotesSection(body: string, links: string[]): string {
  if (links.length === 0) {
    return body.trim();
  }

  const presentLinks = new Set(
    extractWikiLinkTitles(body).map((title) => normalizeTitleKey(title))
  );
  const missingLinks = links.filter((title) => !presentLinks.has(normalizeTitleKey(title)));

  if (missingLinks.length === 0) {
    return body.trim();
  }

  const sectionLines = missingLinks.map((title) => `- [[${title}]]`).join("\n");

  if (body.includes(connectedNotesHeading)) {
    return `${body.trim()}\n${sectionLines}`.trim();
  }

  return [body.trim(), connectedNotesHeading, "", sectionLines].filter(Boolean).join("\n\n");
}

function normalizeWhitespace(body: string): string {
  return body
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function hasEnoughDurableContent(body: string): boolean {
  const normalized = body
    .replace(new RegExp(`${connectedNotesHeading}[\\s\\S]*$`), "")
    .replace(/\[\[([^[\]]+)\]\]/g, "$1")
    .replace(/^#+\s+/gm, "")
    .replace(/[*_`>-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (normalized.length < extractionThresholds.minPreparedBodyChars) {
    return false;
  }

  const words = normalized.split(" ").filter(Boolean);

  return words.length >= extractionThresholds.minPreparedBodyWords;
}

function prepareNoteBody(
  update: ExtractionUpdate,
  existingNote: Pick<WikiNote, "title" | "content"> | null,
  index: ExtractionIndexEntry[]
): {
  nextBody: string;
  links: string[];
} | null {
  let body = normalizeWhitespace(update.body);

  body = stripTranscriptLikeLines(body);
  body = normalizeBulletLines(body);
  body = stripRedundantTitleHeading(body, update.targetTitle);
  body = normalizeWhitespace(body);

  if (body.length === 0) {
    return null;
  }

  const normalizedBodyLinks = normalizeBodyLinks(body, index);
  const resolvedLinks = normalizeLinkTitles(
    [...update.links, ...normalizedBodyLinks.links],
    index
  );
  body = normalizedBodyLinks.body;

  if (update.operation === "append" && existingNote) {
    body = demoteDuplicateHeadings(body, existingNote.content, existingNote.title);
    body = dedupeParagraphsAgainstExisting(existingNote.content, body);
  } else {
    body = demoteDuplicateHeadings(body, "", update.targetTitle);
  }

  body = ensureConnectedNotesSection(body, resolvedLinks);
  body = normalizeWhitespace(body);

  if (!hasEnoughDurableContent(body)) {
    return null;
  }

  return {
    nextBody: body,
    links: resolvedLinks
  };
}

export function prepareExtractionWrite(
  input: PrepareExtractionWriteInput
): PreparedExtractionWrite | null {
  if (input.update.operation === "noop") {
    return null;
  }

  const preparedBody = prepareNoteBody(input.update, input.existingNote, input.index);

  if (!preparedBody) {
    return null;
  }

  const nextContent =
    input.update.operation === "append" && input.existingNote
      ? [input.existingNote.content.trim(), preparedBody.nextBody].filter(Boolean).join("\n\n")
      : preparedBody.nextBody;
  const nextTitle =
    input.update.operation === "append" && input.existingNote
      ? input.existingNote.title
      : input.update.targetTitle;
  const nextTags = normalizeTagList(
    input.existingNote
      ? [...input.existingNote.tags, ...input.update.tags]
      : input.update.tags
  );
  const nextSources = input.existingNote
    ? input.existingNote.sources + (input.update.sources ?? 0)
    : (input.update.sources ?? 1);
  const nextType =
    input.update.operation === "append" && input.existingNote
      ? input.existingNote.type
      : input.update.targetType;

  return {
    slug: input.update.targetSlug,
    title: nextTitle,
    content: normalizeWhitespace(nextContent),
    tags: nextTags,
    type: nextType,
    sources: nextSources,
    url: input.update.url,
    operation: input.update.operation
  };
}
