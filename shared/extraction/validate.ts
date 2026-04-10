import {
  extractionThresholds
} from "./config.ts";
import {
  extractionEvidenceKindValues,
  extractionNoteTypeValues,
  type ExtractionEvidence,
  type ExtractionEvidenceKind,
  type ExtractionIndexEntry,
  type ExtractionOperation,
  type ExtractionResponse,
  type ExtractionUpdate,
  type ExtractionValidationIssue,
  type ExtractionValidationOptions,
  type ExtractionValidationResult
} from "./contracts.ts";
import { extractWikiLinkTitles, normalizeTitleKey, slugifyExtractionTitle } from "./wikiLinks.ts";

const noteTypeSet = new Set<string>(extractionNoteTypeValues);
const evidenceKindSet = new Set<string>(extractionEvidenceKindValues);
const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const connectedNotesHeading = "## Connected Notes";

interface IndexLookups {
  bySlug: Map<string, ExtractionIndexEntry>;
  titleByKey: Map<string, string>;
  existingSlugs: Set<string>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}

function buildIndexLookups(index: ExtractionIndexEntry[]): IndexLookups {
  const bySlug = new Map<string, ExtractionIndexEntry>();
  const titleByKey = new Map<string, string>();
  const existingSlugs = new Set<string>();

  for (const note of index) {
    bySlug.set(note.slug, note);
    titleByKey.set(normalizeTitleKey(note.title), note.title);

    if (!note.isPlaceholder) {
      existingSlugs.add(note.slug);
    }
  }

  return {
    bySlug,
    titleByKey,
    existingSlugs
  };
}

function summarizeMarkdown(value: string): string {
  return value
    .replace(/\[\[([^[\]]+)\]\]/g, "$1")
    .replace(/[#*_`>-]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 240);
}

function clampConfidence(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.min(1, Math.max(0, value));
  }

  if (typeof value === "string") {
    const parsed = Number.parseFloat(value);

    if (Number.isFinite(parsed)) {
      return Math.min(1, Math.max(0, parsed));
    }
  }

  return fallback;
}

function normalizeLinks(raw: unknown, lookups: IndexLookups): string[] {
  if (!Array.isArray(raw)) {
    return [];
  }

  const normalized: string[] = [];

  for (const entry of raw) {
    if (typeof entry !== "string") {
      continue;
    }

    const trimmed = entry.trim();

    if (trimmed.length === 0) {
      continue;
    }

    if (trimmed.endsWith(".md")) {
      const matchedNote = lookups.bySlug.get(trimmed.replace(/\.md$/i, ""));

      if (matchedNote) {
        normalized.push(matchedNote.title);
      }

      continue;
    }

    const matchedTitle = lookups.titleByKey.get(normalizeTitleKey(trimmed));

    if (matchedTitle) {
      normalized.push(matchedTitle);
    }
  }

  return uniqueStrings(normalized);
}

function sanitizeBodyLinks(body: string, lookups: IndexLookups): string {
  return body.replace(/\[\[([^[\]]+)\]\]/g, (_match, rawTitle: string) => {
    const title = rawTitle.trim();
    const matchedTitle = lookups.titleByKey.get(normalizeTitleKey(title));

    if (!matchedTitle) {
      return title;
    }

    return `[[${matchedTitle}]]`;
  });
}

function ensureDeclaredLinksInBody(body: string, links: string[]): string {
  if (links.length === 0) {
    return body.trim();
  }

  const presentLinkKeys = new Set(
    extractWikiLinkTitles(body).map((title) => normalizeTitleKey(title))
  );
  const missingLinks = links.filter((title) => !presentLinkKeys.has(normalizeTitleKey(title)));

  if (missingLinks.length === 0) {
    return body.trim();
  }

  const lines = missingLinks.map((title) => `- [[${title}]]`).join("\n");

  if (body.includes(connectedNotesHeading)) {
    return `${body.trim()}\n${lines}`;
  }

  return [body.trim(), connectedNotesHeading, "", lines].filter(Boolean).join("\n\n");
}

function normalizeEvidence(
  raw: unknown,
  fallback: ExtractionEvidence
): ExtractionEvidence[] {
  if (!Array.isArray(raw)) {
    return [fallback];
  }

  const evidence: ExtractionEvidence[] = [];

  for (const entry of raw) {
    if (typeof entry === "string") {
      const ref = entry.trim();

      if (ref.length > 0) {
        evidence.push({
          kind: fallback.kind,
          ref
        });
      }

      continue;
    }

    if (!isRecord(entry)) {
      continue;
    }

    const kind =
      typeof entry.kind === "string" && evidenceKindSet.has(entry.kind)
        ? (entry.kind as ExtractionEvidenceKind)
        : fallback.kind;
    const ref = typeof entry.ref === "string" ? entry.ref.trim() : "";
    const summary =
      typeof entry.summary === "string" && entry.summary.trim().length > 0
        ? entry.summary.trim().slice(0, 240)
        : undefined;

    if (ref.length === 0) {
      continue;
    }

    evidence.push({
      kind,
      ref,
      ...(summary ? { summary } : {})
    });
  }

  if (evidence.length === 0) {
    return [fallback];
  }

  return uniqueEvidence(evidence);
}

function uniqueEvidence(values: ExtractionEvidence[]): ExtractionEvidence[] {
  const seen = new Set<string>();
  const unique: ExtractionEvidence[] = [];

  for (const value of values) {
    const key = `${value.kind}:${value.ref}:${value.summary ?? ""}`;

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    unique.push(value);
  }

  return unique;
}

function resolveOperation(raw: unknown): ExtractionOperation | null {
  if (typeof raw !== "string") {
    return null;
  }

  const candidate = raw.trim().toLowerCase();

  if (candidate === "update") {
    return "rewrite";
  }

  if (
    candidate === "create" ||
    candidate === "append" ||
    candidate === "rewrite" ||
    candidate === "noop"
  ) {
    return candidate;
  }

  return null;
}

function readNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function humanizeSlug(slug: string): string {
  return slug
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function normalizeSlug(raw: Record<string, unknown>): string | null {
  const directSlug = readNonEmptyString(raw.targetSlug);

  if (directSlug && slugPattern.test(directSlug)) {
    return directSlug;
  }

  const file = readNonEmptyString(raw.file);

  if (file) {
    const fromFile = file.replace(/\.md$/i, "");

    if (slugPattern.test(fromFile)) {
      return fromFile;
    }
  }

  const rawTitle = readNonEmptyString(raw.targetTitle) ?? readNonEmptyString(raw.title);

  if (rawTitle) {
    return slugifyExtractionTitle(rawTitle);
  }

  return null;
}

function normalizeNoteType(raw: Record<string, unknown>): ExtractionUpdate["targetType"] {
  const candidate = readNonEmptyString(raw.targetType) ?? readNonEmptyString(raw.type);

  if (candidate && noteTypeSet.has(candidate)) {
    return candidate as ExtractionUpdate["targetType"];
  }

  return "concept";
}

function normalizeUpdate(
  raw: unknown,
  indexPosition: number,
  lookups: IndexLookups,
  options: ExtractionValidationOptions
): {
  update: ExtractionUpdate | null;
  issues: ExtractionValidationIssue[];
} {
  const issues: ExtractionValidationIssue[] = [];

  if (!isRecord(raw)) {
    return {
      update: null,
      issues: [
        {
          path: `updates[${indexPosition}]`,
          message: "Update must be an object."
        }
      ]
    };
  }

  const operation = resolveOperation(raw.operation ?? raw.action);

  if (!operation) {
    return {
      update: null,
      issues: [
        {
          path: `updates[${indexPosition}].operation`,
          message: "Update must include a valid operation."
        }
      ]
    };
  }

  const targetSlug = normalizeSlug(raw);

  if (!targetSlug) {
    return {
      update: null,
      issues: [
        {
          path: `updates[${indexPosition}].targetSlug`,
          message: "Update must include a valid slug or file."
        }
      ]
    };
  }

  const matchedIndexNote = lookups.bySlug.get(targetSlug);
  const rawTitle = readNonEmptyString(raw.targetTitle) ?? readNonEmptyString(raw.title);
  const targetTitle = matchedIndexNote?.title ?? rawTitle ?? humanizeSlug(targetSlug);
  const rawBody = readNonEmptyString(raw.body) ?? readNonEmptyString(raw.content) ?? "";
  const normalizedLinks = normalizeLinks(raw.links ?? raw.linkedTo, lookups);
  const sanitizedBody = ensureDeclaredLinksInBody(
    sanitizeBodyLinks(rawBody, lookups),
    normalizedLinks
  );
  const fallbackKind: ExtractionEvidenceKind = options.sourceType ? "source" : "transcript";
  const fallbackEvidence: ExtractionEvidence = {
    kind: fallbackKind,
    ref: options.sourcePath ?? (options.sourceType ?? "transcript")
  };

  let normalizedOperation = operation;
  const existsAlready = lookups.existingSlugs.has(targetSlug);
  const fallbackConfidence = operation === "rewrite" ? 0.76 : operation === "noop" ? 1 : 0.58;
  const confidence = clampConfidence(raw.confidence, fallbackConfidence);

  if (normalizedOperation === "append" && !existsAlready) {
    normalizedOperation = "create";
  }

  if (normalizedOperation === "rewrite" && !existsAlready) {
    normalizedOperation = "create";
  }

  if (normalizedOperation === "create" && existsAlready) {
    normalizedOperation = "append";
  }

  if (normalizedOperation === "rewrite" && confidence < extractionThresholds.rewriteConfidenceFloor) {
    normalizedOperation = "append";
  }

  const summary =
    readNonEmptyString(raw.summary)?.slice(0, 240) ??
    summarizeMarkdown(sanitizedBody).slice(0, 240);

  if (
    normalizedOperation !== "noop" &&
    sanitizedBody.trim().length < extractionThresholds.minValidatedBodyChars
  ) {
    issues.push({
      path: `updates[${indexPosition}].body`,
      message: "Update body was too short to keep."
    });

    return {
      update: null,
      issues
    };
  }

  const tags = uniqueStrings(
    (Array.isArray(raw.tags) ? raw.tags : [])
      .filter((value): value is string => typeof value === "string")
      .map((value) => value.trim().toLowerCase())
      .filter((value) => value.length > 0)
  ).slice(0, extractionThresholds.maxTagsPerNote);

  const evidence = normalizeEvidence(raw.evidence, fallbackEvidence);

  return {
    update: {
      operation: normalizedOperation,
      targetSlug,
      targetTitle: targetTitle.slice(0, 120),
      targetType: normalizeNoteType(raw),
      summary,
      body: sanitizedBody.trim(),
      tags,
      links: normalizedLinks,
      evidence,
      confidence,
      sources: options.sourceType ? 1 : 0,
      url: options.sourceType === "web" ? options.sourcePath : undefined
    },
    issues
  };
}

function mergeBodies(updates: ExtractionUpdate[]): string {
  const uniqueBodies = uniqueStrings(
    updates
      .map((update) => update.body.trim())
      .filter((body) => body.length > 0)
  );

  if (uniqueBodies.length === 0) {
    return "";
  }

  if (uniqueBodies.length === 1) {
    return uniqueBodies[0] ?? "";
  }

  return uniqueBodies.join("\n\n");
}

function mergeOperations(updates: ExtractionUpdate[]): ExtractionOperation {
  if (updates.some((update) => update.operation === "rewrite")) {
    return "rewrite";
  }

  if (updates.some((update) => update.operation === "create")) {
    return "create";
  }

  if (updates.some((update) => update.operation === "append")) {
    return "append";
  }

  return "noop";
}

function mergeDuplicateUpdates(
  updates: ExtractionUpdate[],
  lookups: IndexLookups
): ExtractionUpdate[] {
  const grouped = new Map<string, ExtractionUpdate[]>();

  for (const update of updates) {
    const group = grouped.get(update.targetSlug) ?? [];
    group.push(update);
    grouped.set(update.targetSlug, group);
  }

  const merged: ExtractionUpdate[] = [];

  for (const group of grouped.values()) {
    const [first] = group;

    if (!first) {
      continue;
    }

    const operation = mergeOperations(group);
    const latest = group[group.length - 1] ?? first;
    const mergedLinks = uniqueStrings(group.flatMap((update) => update.links));
    const mergedBody = ensureDeclaredLinksInBody(
      sanitizeBodyLinks(mergeBodies(group), lookups),
      mergedLinks
    );

    if (operation !== "noop" && mergedBody.trim().length < extractionThresholds.minValidatedBodyChars) {
      continue;
    }

    merged.push({
      operation,
      targetSlug: first.targetSlug,
      targetTitle: latest.targetTitle,
      targetType: latest.targetType,
      summary: latest.summary || summarizeMarkdown(mergedBody),
      body: mergedBody.trim(),
      tags: uniqueStrings(group.flatMap((update) => update.tags)).slice(
        0,
        extractionThresholds.maxTagsPerNote
      ),
      links: mergedLinks,
      evidence: uniqueEvidence(group.flatMap((update) => update.evidence)),
      confidence: Math.max(...group.map((update) => update.confidence)),
      sources: Math.max(...group.map((update) => update.sources ?? 0)),
      url: [...group].reverse().find((update) => typeof update.url === "string")?.url
    });
  }

  return merged.filter((update) => update.operation !== "noop");
}

export function validateExtractionResponse(
  input: unknown,
  options: ExtractionValidationOptions = {}
): ExtractionValidationResult {
  if (!isRecord(input)) {
    return {
      value: null,
      issues: [
        {
          path: "root",
          message: "Extraction payload must be an object."
        }
      ]
    };
  }

  if (!Array.isArray(input.updates)) {
    return {
      value: null,
      issues: [
        {
          path: "updates",
          message: "Extraction payload must include an updates array."
        }
      ]
    };
  }

  const issues: ExtractionValidationIssue[] = [];
  const lookups = buildIndexLookups(options.index ?? []);
  const updates: ExtractionUpdate[] = [];

  for (const [index, rawUpdate] of input.updates.entries()) {
    const normalized = normalizeUpdate(rawUpdate, index, lookups, options);
    issues.push(...normalized.issues);

    if (normalized.update) {
      updates.push(normalized.update);
    }
  }

  const sessionTitle =
    readNonEmptyString(input.sessionTitle)?.slice(0, 60) ?? "Untitled Session";

  return {
    value: {
      updates: mergeDuplicateUpdates(updates, lookups),
      sessionTitle
    },
    issues
  };
}

export function parseExtractionResponseJson(
  raw: string,
  options: ExtractionValidationOptions = {}
): ExtractionValidationResult {
  const cleaned = raw
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  try {
    const parsed = JSON.parse(cleaned) as unknown;
    return validateExtractionResponse(parsed, options);
  } catch {
    return {
      value: null,
      issues: [
        {
          path: "root",
          message: "Extraction payload was not valid JSON."
        }
      ]
    };
  }
}
