import type {
  ExtractionIndexEntry,
  ExtractionUpdate
} from "../../../shared/extraction/contracts";
import {
  applyKeyValueBulletSupersession,
  applyMerge,
  containsGfmPipeTable,
  inferAppendSectionPatches,
  reconcileNoteContent,
  splitConnectedNotesFromBody,
  stripGfmPipeTables
} from "./mergeNote";
import { extractionThresholds } from "../../../shared/extraction/config";
import {
  extractWikiLinkTitles,
  normalizeTitleKey
} from "../../../shared/extraction/wikiLinks";
import { normalizeWikiFolderPath } from "../../../shared/vault/folderPath";
import type { WikiNote } from "../../ipc/types";

interface PreparedExtractionWrite {
  slug: string;
  title: string;
  content: string;
  tags: string[];
  type: ExtractionUpdate["targetType"];
  sources: number;
  folderPath: string;
  url?: string;
  operation: "create" | "append" | "rewrite" | "merge";
}

interface PrepareExtractionWriteInput {
  update: ExtractionUpdate;
  existingNote: Pick<WikiNote, "title" | "content" | "tags" | "sources" | "type" | "folderPath"> | null;
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

function normalizeBodyLinks(
  body: string,
  index: ExtractionIndexEntry[],
  noteTitle?: string | null
): {
  body: string;
  links: string[];
} {
  const lookups = buildIndexLookups(index);
  const resolvedLinks: string[] = [];
  const selfKey = noteTitle ? normalizeTitleKey(noteTitle) : "";

  const normalizedBody = body.replace(/\[\[([^[\]]+)\]\]/g, (_match, rawTitle: string) => {
    const trimmedTitle = rawTitle.trim();
    const matchedTitle = lookups.titleByKey.get(normalizeTitleKey(trimmedTitle));

    if (!matchedTitle) {
      return trimmedTitle;
    }

    if (selfKey.length > 0 && normalizeTitleKey(matchedTitle) === selfKey) {
      return matchedTitle;
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

function excludeSelfNoteLinks(links: string[], noteTitle: string): string[] {
  const selfKey = normalizeTitleKey(noteTitle);

  if (selfKey.length === 0) {
    return links;
  }

  return links.filter((title) => normalizeTitleKey(title) !== selfKey);
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

function normalizeWhitespace(body: string): string {
  return body
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** First paragraph only: strip common assistant chat preambles from captured notes. */
function stripLeadingAssistantHedge(paragraph: string): string {
  let t = paragraph.trim();

  t = t.replace(/^(?:Absolutely|Sure|Of course|Certainly)\s*[—–\-:]\s*/i, "");
  t = t.replace(
    /^(?:Great question|Good question|Happy to help)\b[^.!?\n]{0,220}[.!?:—\-]\s*/i,
    ""
  );
  t = t.replace(
    /^Here(?:'|’)?s\s+(?:a|an|the)\s+(?:structured|detailed|complete|comprehensive|brief|quick|helpful|overview)\b[\s\S]{0,1200}?[.!?]\s*/i,
    ""
  );
  t = t.replace(/^I(?:’|’)?d\s+be\s+happy\s+to[^.!?\n]*[.:—\-]\s*/i, "");
  t = t.replace(/^I(?:’|’)?d\s+(?:recommend|suggest)\s+/i, "");
  t = t.replace(/^I\s+(?:think|believe|suggest|recommend)\s+(?:the\s+key|that)\s+/i, "");
  t = t.replace(/^Let me\s+(?:know|help)[^.!?\n]*[.:—\-]\s*/i, "");
  t = t.replace(/^that tracks,?\s+and\s+it(?:'|’)s\s+a\s+useful\s+distinction[^.!?\n]*[.!?:]\s*/i, "");

  return t.trim();
}

/** Drop assistant “bridge” openers that are not standalone note summaries. */
function stripLeadingConversationalSummaryParagraphs(sectionContent: string): string {
  let parts = sectionContent.split(/\n\n+/).map((p) => p.trim()).filter(Boolean);
  let removedAny = false;

  while (parts.length > 0) {
    const p = parts[0] ?? "";

    if (/^that tracks\b/i.test(p)) {
      parts = parts.slice(1);
      removedAny = true;
      continue;
    }

    if (
      /^here are (?:the main |a few )?reasons\b/i.test(p) &&
      (parts.length >= 2 || removedAny)
    ) {
      parts = parts.slice(1);
      removedAny = true;
      continue;
    }

    break;
  }

  return parts.join("\n\n").trim();
}

/**
 * Remove trailing paragraphs that are clearly assistant chat-wrappers (offers to continue the
 * conversation), not durable note content.
 */
function stripTrailingAssistantOfferParagraphs(body: string): string {
  const parts = body.split(/\n\n+/).map((p) => p.trim()).filter(Boolean);

  if (parts.length <= 1) {
    return body.trim();
  }

  const isClosingOffer = (paragraph: string): boolean => {
    const t = paragraph.replace(/\s+/g, " ").trim();
    if (t.length === 0 || t.length > 1400) {
      return false;
    }

    if (/^(?:If you want|If you'd like|Feel free to|Happy to|Want me to)\b/i.test(t)) {
      return true;
    }
    if (/^Let me know\b/i.test(t)) {
      return true;
    }
    if (/^(?:In conclusion|In summary|To summarize|To wrap up|Overall)\b/i.test(t)) {
      return true;
    }
    if (/^(?:I hope this helps|This should give you|This provides|This covers)\b/i.test(t)) {
      return true;
    }
    if (/^By (?:following|implementing|using) (?:these|this|the above)\b/i.test(t)) {
      return true;
    }
    if (/\bI'll give you\b/i.test(t) && /\b(template|reusable|memo)\b/i.test(t)) {
      return true;
    }
    if (/\btell me what\b/i.test(t) && /\?\s*$/.test(t)) {
      return true;
    }
    if (/\?\s*$/.test(t) && t.length < 420 && /\b(?:if you|want me to|should I|can I)\b/i.test(t)) {
      return true;
    }

    return false;
  };

  let end = parts.length;

  while (end > 1 && isClosingOffer(parts[end - 1] ?? "")) {
    end -= 1;
  }

  return parts.slice(0, end).join("\n\n").trim();
}

function stripAssistantFillersFromSummarySection(body: string): string {
  const re = /(##\s+Summary\s*\n+)([\s\S]*?)(?=\n##[^#]|\n#\s[^#]|$)/;
  return body.replace(re, (_match, heading, sectionContent) => {
    let inner = sectionContent.trim();
    inner = stripLeadingConversationalSummaryParagraphs(inner);
    const parts = inner.split(/\n\n+/);

    if (parts.length === 0 || !parts[0]) {
      return inner.length === 0 ? "" : `${heading}${inner}`;
    }

    parts[0] = stripLeadingAssistantHedge(parts[0].trim());
    const joined = parts.join("\n\n").trim();
    return joined.length === 0 ? "" : `${heading}${joined}`;
  });
}

function stripOpeningAssistantHedgesFromBody(body: string): string {
  const paragraphs = body.split(/\n\n+/);

  if (paragraphs.length === 0) {
    return body;
  }

  paragraphs[0] = stripLeadingAssistantHedge(paragraphs[0] ?? "");
  return paragraphs.join("\n\n");
}

/**
 * Within one extraction response, skip writing a second file whose body is identical
 * to an already-applied prepared write (different slugs/titles, same distilled content).
 */
export function skipIfDuplicatePreparedExtractionContent(
  seenNormalizedBodies: Set<string>,
  content: string
): boolean {
  const key = normalizeWhitespace(content).replace(/\s+/g, " ").trim().toLowerCase();

  if (seenNormalizedBodies.has(key)) {
    return true;
  }

  seenNormalizedBodies.add(key);
  return false;
}

function appendBeforeConnectedNotes(existingContent: string, nextBody: string): string {
  const existing = existingContent.trim();
  const next = nextBody.trim();

  if (existing.length === 0) {
    return next;
  }

  if (next.length === 0) {
    return existing;
  }

  const lines = existing.split("\n");
  const connectedNotesIndex = lines.findIndex(
    (line) => line.trim() === connectedNotesHeading
  );

  if (connectedNotesIndex === -1) {
    return [existing, next].join("\n\n");
  }

  const nextLines = next.split("\n");
  const nextConnectedNotesIndex = nextLines.findIndex(
    (line) => line.trim() === connectedNotesHeading
  );
  const nextBeforeConnectedNotes =
    nextConnectedNotesIndex === -1
      ? next
      : nextLines.slice(0, nextConnectedNotesIndex).join("\n").trim();
  const nextConnectedNoteLines =
    nextConnectedNotesIndex === -1
      ? []
      : nextLines
          .slice(nextConnectedNotesIndex + 1)
          .map((line) => line.trim())
          .filter((line) => line.length > 0);
  const before = lines.slice(0, connectedNotesIndex).join("\n").trim();
  const afterLines = lines.slice(connectedNotesIndex);
  const connectedLinkKeys = new Set(
    extractWikiLinkTitles(afterLines.join("\n")).map((title) => normalizeTitleKey(title))
  );
  const connectedRawLines = new Set(afterLines.map((line) => line.trim()).filter(Boolean));

  for (const line of nextConnectedNoteLines) {
    const [linkedTitle] = extractWikiLinkTitles(line);
    const linkedKey = linkedTitle ? normalizeTitleKey(linkedTitle) : "";

    if (linkedKey && connectedLinkKeys.has(linkedKey)) {
      continue;
    }

    if (!linkedKey && connectedRawLines.has(line)) {
      continue;
    }

    afterLines.push(line);
    connectedRawLines.add(line);

    if (linkedKey) {
      connectedLinkKeys.add(linkedKey);
    }
  }

  const after = afterLines.join("\n").trim();

  return [before, nextBeforeConnectedNotes, after]
    .filter((section) => section.length > 0)
    .join("\n\n");
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

/** Text cleanup for extraction markdown (link resolution happens separately). */
function sanitizeMarkdownFragment(
  fragment: string,
  update: Pick<ExtractionUpdate, "targetTitle">
): string {
  let body = normalizeWhitespace(fragment);

  body = stripTranscriptLikeLines(body);
  body = normalizeBulletLines(body);
  body = stripRedundantTitleHeading(body, update.targetTitle);
  body = normalizeWhitespace(body);
  body = stripTrailingAssistantOfferParagraphs(body);
  body = stripAssistantFillersFromSummarySection(body);
  body = stripOpeningAssistantHedgesFromBody(body);
  body = normalizeWhitespace(body);

  return body.trim();
}

function prepareNoteBody(
  update: ExtractionUpdate,
  existingNote: Pick<WikiNote, "title" | "content"> | null,
  index: ExtractionIndexEntry[]
): {
  nextBody: string;
  links: string[];
} | null {
  let body = sanitizeMarkdownFragment(update.body, update);

  if (body.length === 0) {
    return null;
  }

  const normalizedBodyLinks = normalizeBodyLinks(body, index, update.targetTitle);
  const resolvedLinks = excludeSelfNoteLinks(
    normalizeLinkTitles([...update.links, ...normalizedBodyLinks.links], index),
    update.targetTitle
  );
  body = normalizedBodyLinks.body;

  if (update.operation === "append" && existingNote) {
    // Duplicate-heading demotion and paragraph dedupe run in prepareExtractionWrite
    // after optional section-level merge.
  } else if (update.operation !== "merge") {
    body = demoteDuplicateHeadings(body, "", update.targetTitle);
  }

  body = normalizeWhitespace(body);

  if (!hasEnoughDurableContent(body)) {
    return null;
  }

  return {
    nextBody: body,
    links: resolvedLinks
  };
}

function buildAppendMergedContent(
  existingContent: string,
  preparedFragment: string,
  noteTitle: string,
  index: ExtractionIndexEntry[]
): string {
  const { main: existingMain, connectedSuffix: existingConn } =
    splitConnectedNotesFromBody(existingContent);
  const { main: fragMain } = splitConnectedNotesFromBody(preparedFragment);

  let kvMain = applyKeyValueBulletSupersession(existingMain, fragMain);
  let { patches, residual } = inferAppendSectionPatches(kvMain, fragMain);

  /** When headings differ but both sides have a schedule-style pipe table, strip old tables and re-infer. */
  let attemptedPipeTableSupersede = false;
  if (
    containsGfmPipeTable(kvMain) &&
    containsGfmPipeTable(fragMain) &&
    patches.length === 0
  ) {
    attemptedPipeTableSupersede = true;
    kvMain = stripGfmPipeTables(kvMain);
    ({ patches, residual } = inferAppendSectionPatches(kvMain, fragMain));
  }

  const sanitizedPatches = patches.map((patch) => ({
    ...patch,
    body: sanitizeMarkdownFragment(patch.body, { targetTitle: noteTitle })
  }));

  let merged: string;

  const usePipeTableFragmentFallback =
    attemptedPipeTableSupersede &&
    sanitizedPatches.length === 0 &&
    residual.trim().length > 0 &&
    containsGfmPipeTable(residual);

  if (usePipeTableFragmentFallback) {
    const syntheticExisting =
      kvMain + (existingConn.length > 0 ? `\n\n${existingConn}` : "");
    merged = appendBeforeConnectedNotes(syntheticExisting, fragMain);
  } else if (sanitizedPatches.length > 0 || residual.trim().length > 0) {
    const existingForMerge =
      kvMain + (existingConn.length > 0 ? `\n\n${existingConn}` : "");
    merged = applyMerge(existingForMerge, sanitizedPatches, residual.trim() || undefined).content;
  } else {
    let demoted = demoteDuplicateHeadings(fragMain, existingContent, noteTitle);
    demoted = dedupeParagraphsAgainstExisting(existingContent, demoted);
    merged = appendBeforeConnectedNotes(existingContent, demoted);
  }

  const normalizedBodyLinks = normalizeBodyLinks(merged, index, noteTitle);
  merged = normalizedBodyLinks.body;
  merged = reconcileNoteContent(normalizeWhitespace(merged));
  return merged;
}

function buildMergeWriteContent(
  update: ExtractionUpdate,
  existingContent: string,
  index: ExtractionIndexEntry[]
): { content: string; links: string[] } | null {
  const patches = update.sectionPatches ?? [];
  const sanitizedPatches = patches.map((patch) => ({
    ...patch,
    body: sanitizeMarkdownFragment(patch.body, update)
  }));
  const residual =
    update.residualBody !== undefined ? sanitizeMarkdownFragment(update.residualBody, update) : undefined;

  const { content: merged } = applyMerge(existingContent, sanitizedPatches, residual);
  const normalizedBodyLinks = normalizeBodyLinks(merged, index, update.targetTitle);
  let body = normalizedBodyLinks.body;
  const resolvedLinks = excludeSelfNoteLinks(
    normalizeLinkTitles([...update.links, ...normalizedBodyLinks.links], index),
    update.targetTitle
  );
  body = reconcileNoteContent(normalizeWhitespace(body));

  if (!hasEnoughDurableContent(body)) {
    return null;
  }

  return { content: body, links: resolvedLinks };
}

export function prepareExtractionWrite(
  input: PrepareExtractionWriteInput
): PreparedExtractionWrite | null {
  if (input.update.operation === "noop") {
    return null;
  }

  const mergeUsesPatches =
    input.update.operation === "merge" &&
    input.existingNote &&
    ((input.update.sectionPatches?.length ?? 0) > 0 || Boolean(input.update.residualBody?.trim()));

  if (mergeUsesPatches) {
    const built = buildMergeWriteContent(
      input.update,
      input.existingNote!.content,
      input.index
    );

    if (!built) {
      return null;
    }

    return finalizePreparedExtractionWrite(input, built.content, "merge");
  }

  const preparedBody = prepareNoteBody(input.update, input.existingNote, input.index);

  if (!preparedBody) {
    return null;
  }

  let nextContent: string;

  if (input.update.operation === "append" && input.existingNote) {
    nextContent = buildAppendMergedContent(
      input.existingNote.content,
      preparedBody.nextBody,
      input.existingNote.title,
      input.index
    );
  } else {
    nextContent = reconcileNoteContent(normalizeWhitespace(preparedBody.nextBody));
  }

  return finalizePreparedExtractionWrite(input, nextContent, input.update.operation);
}

function finalizePreparedExtractionWrite(
  input: PrepareExtractionWriteInput,
  content: string,
  operation: PreparedExtractionWrite["operation"]
): PreparedExtractionWrite {
  const nextTitle =
    (operation === "append" || operation === "merge") && input.existingNote
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
    (operation === "append" || operation === "merge") && input.existingNote
      ? input.existingNote.type
      : input.update.targetType;

  const resolvedFolderPath =
    input.update.folderPath !== undefined
      ? normalizeWikiFolderPath(input.update.folderPath)
      : normalizeWikiFolderPath(input.existingNote?.folderPath ?? "");

  return {
    slug: input.update.targetSlug,
    title: nextTitle,
    content: normalizeWhitespace(content),
    tags: nextTags,
    type: nextType,
    sources: nextSources,
    folderPath: resolvedFolderPath,
    url: input.update.url,
    operation
  };
}
