import { extractionThresholds } from "./config.ts";
import {
  extractionEvidenceKindValues,
  extractionNoteTypeValues,
  type ExtractionEvidence,
  type ExtractionEvidenceKind,
  type ExtractionIndexEntry,
  type ExtractionOperation,
  type ExtractionResponse,
  type ExtractionSectionPatch,
  type ExtractionUpdate,
  type ExtractionValidationIssue,
  type ExtractionValidationOptions,
  type ExtractionValidationResult
} from "./contracts.ts";
import {
  extractWikiLinkTitles,
  normalizeTitleKey,
  slugifyExtractionTitle
} from "./wikiLinks.ts";
import { normalizeWikiFolderPath } from "../vault/folderPath.ts";

const noteTypeSet = new Set<string>(extractionNoteTypeValues);
const evidenceKindSet = new Set<string>(extractionEvidenceKindValues);
const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const connectedNotesHeading = "## Connected Notes";

interface IndexLookups {
  bySlug: Map<string, ExtractionIndexEntry>;
  titleByKey: Map<string, string>;
  slugByTitleSlugKey: Map<string, string>;
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
  const slugByTitleSlugKey = new Map<string, string>();
  const existingSlugs = new Set<string>();

  for (const note of index) {
    bySlug.set(note.slug, note);
    titleByKey.set(normalizeTitleKey(note.title), note.title);
    slugByTitleSlugKey.set(slugifyExtractionTitle(note.title), note.slug);

    if (!note.isPlaceholder) {
      existingSlugs.add(note.slug);
    }
  }

  return {
    bySlug,
    titleByKey,
    slugByTitleSlugKey,
    existingSlugs
  };
}

function updateQualifierStrippedSlugCandidates(value: string): string[] {
  const base = slugifyExtractionTitle(value);
  const candidates: string[] = [];
  const suffixes = [
    "update",
    "updates",
    "updated",
    "revision",
    "revisions",
    "revised",
    "copy",
    "duplicate",
    "duplicated"
  ];
  const prefixes = ["updated", "revised", "copy", "duplicate", "duplicated"];
  const push = (candidate: string): void => {
    const trimmed = candidate.replace(/^-+|-+$/g, "");

    if (trimmed && trimmed !== base && !candidates.includes(trimmed)) {
      candidates.push(trimmed);
    }
  };

  for (const suffix of suffixes) {
    if (base.endsWith(`-${suffix}`)) {
      push(base.slice(0, -suffix.length - 1));
    }
  }

  for (const prefix of prefixes) {
    if (base.startsWith(`${prefix}-`)) {
      push(base.slice(prefix.length + 1));
    }
  }

  if (base.startsWith("copy-of-")) {
    push(base.slice("copy-of-".length));
  }

  return candidates;
}

function resolveSlugCandidate(lookups: IndexLookups, candidate: string): string | null {
  if (lookups.bySlug.has(candidate)) {
    return candidate;
  }

  return lookups.slugByTitleSlugKey.get(candidate) ?? null;
}

/**
 * When the model invents a sibling slug while the title matches an existing note, prefer the
 * vault slug so we append/rewrite instead of creating a duplicate file.
 */
function resolveCanonicalTargetSlug(
  lookups: IndexLookups,
  initialSlug: string,
  rawTitle: string | null,
  sessionPriorSlugs?: string[]
): string {
  if (lookups.bySlug.size === 0 && (!sessionPriorSlugs || sessionPriorSlugs.length === 0)) {
    return initialSlug;
  }

  const titleKey = rawTitle ? normalizeTitleKey(rawTitle) : "";

  if (titleKey.length > 0) {
    for (const note of lookups.bySlug.values()) {
      if (normalizeTitleKey(note.title) === titleKey) {
        return note.slug;
      }
    }
  }

  const slugFromTitle = rawTitle ? slugifyExtractionTitle(rawTitle) : "";

  if (slugFromTitle && lookups.bySlug.has(slugFromTitle)) {
    return slugFromTitle;
  }

  const strippedCandidates = [
    ...(rawTitle ? updateQualifierStrippedSlugCandidates(rawTitle) : []),
    ...updateQualifierStrippedSlugCandidates(initialSlug)
  ];

  for (const candidate of strippedCandidates) {
    const resolved = resolveSlugCandidate(lookups, candidate);

    if (resolved) {
      return resolved;
    }
  }

  if (sessionPriorSlugs && sessionPriorSlugs.length > 0 && titleKey.length > 0) {
    for (const priorSlug of sessionPriorSlugs) {
      const priorNote = lookups.bySlug.get(priorSlug);
      if (priorNote && normalizeTitleKey(priorNote.title) === titleKey) {
        return priorSlug;
      }
    }
  }

  return initialSlug;
}

function summarizeMarkdown(value: string): string {
  return value
    .replace(/\[\[([^[\]]+)\]\]/g, "$1")
    .replace(/[#*_`>-]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 240);
}

/** Model often copies session-title placeholders like "Brief Chat" into targetTitle; reject those. */
const UNACCEPTABLE_GENERIC_NOTE_TITLE_KEYS = new Set([
  "brief chat",
  "new conversation",
  "new chat",
  "discussion",
  "chat",
  "untitled",
  "notes",
  "untitled session",
  "chat about stuff",
  "quick chat",
  "short chat",
  "conversation",
  "general",
  "misc",
  "miscellaneous",
  "topic",
  "update",
  "important",
  "note",
  "synthesis",
  "summary"
]);

const GENERIC_SECTION_HEADING_KEYS = new Set([
  "summary",
  "details",
  "overview",
  "introduction",
  "key details",
  "connected notes",
  "next steps",
  "open questions",
  "plan",
  "background"
]);

/** Exported for manual/auto chat capture fallbacks that must not reuse session placeholders as note titles. */
export function isUnacceptableGenericNoteTitle(title: string): boolean {
  const key = normalizeTitleKey(title);
  if (key.length === 0) {
    return true;
  }
  return UNACCEPTABLE_GENERIC_NOTE_TITLE_KEYS.has(key);
}

function extractFirstSubstantiveHeading(body: string): string | null {
  const re = /^#{1,3}\s+(.+)$/gm;
  let match: RegExpExecArray | null;

  while ((match = re.exec(body)) !== null) {
    const text =
      match[1]
        ?.trim()
        .replace(/\s+#+\s*$/, "")
        .slice(0, 120) ?? "";
    const key = normalizeTitleKey(text);
    if (key.length === 0 || GENERIC_SECTION_HEADING_KEYS.has(key)) {
      continue;
    }
    if (!isUnacceptableGenericNoteTitle(text)) {
      return text;
    }
  }

  return null;
}

function clipWords(text: string, maxWords: number, maxChars: number): string {
  const words = text.split(/\s+/).filter(Boolean).slice(0, maxWords);
  let out = words.join(" ");
  if (out.length > maxChars) {
    out = out.slice(0, maxChars).replace(/\s+\S*$/, "").trim();
  }
  return out;
}

function titleFromSummaryOrExcerpt(summary: string, bodyPlain: string): string | null {
  const fromSummary = clipWords(summary.replace(/\s+/g, " ").trim(), 14, 100);
  if (fromSummary.length >= 10 && !isUnacceptableGenericNoteTitle(fromSummary)) {
    return fromSummary;
  }

  const excerpt = clipWords(bodyPlain, 14, 100);
  if (excerpt.length >= 10 && !isUnacceptableGenericNoteTitle(excerpt)) {
    return excerpt;
  }

  return null;
}

/**
 * When the model emits a placeholder note title, derive a concise title from note content.
 */
function deriveDescriptiveNoteTitle(body: string, summary: string, targetSlug: string): string | null {
  const heading = extractFirstSubstantiveHeading(body);

  if (heading) {
    return heading.slice(0, 120);
  }

  const bodyPlain = summarizeMarkdown(body);
  const fromText = titleFromSummaryOrExcerpt(summary, bodyPlain);

  if (fromText) {
    return fromText.slice(0, 120);
  }

  const fromSlug = humanizeSlug(targetSlug);
  if (!isUnacceptableGenericNoteTitle(fromSlug)) {
    return fromSlug.slice(0, 120);
  }

  return null;
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
    candidate === "merge" ||
    candidate === "noop"
  ) {
    return candidate;
  }

  return null;
}

function normalizeHeadingKeyForPatch(heading: string): string {
  return heading
    .trim()
    .replace(/^#{1,6}\s+/, "")
    .replace(/\[\[([^[\]]+)\]\]/g, "$1")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function readSectionPatches(raw: Record<string, unknown>): ExtractionSectionPatch[] {
  const rawPatches = raw.sectionPatches;
  if (!Array.isArray(rawPatches)) {
    return [];
  }

  const out: ExtractionSectionPatch[] = [];

  for (const entry of rawPatches) {
    if (!isRecord(entry)) {
      continue;
    }

    const heading = readNonEmptyString(entry.heading);

    if (!heading) {
      continue;
    }

    const body = typeof entry.body === "string" ? entry.body : "";
    const mode = entry.mode === "merge-bullets" ? "merge-bullets" : "replace";
    out.push({ heading, body, mode });
  }

  return out;
}

function flattenMergeToBody(patches: ExtractionSectionPatch[], residual?: string): string {
  const parts = [
    ...patches.map((patch) => `${patch.heading.trim()}\n\n${patch.body.trim()}`),
    residual?.trim() ?? ""
  ].filter((part) => part.length > 0);

  return parts.join("\n\n");
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

  let targetSlug = normalizeSlug(raw);

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

  const rawTitle = readNonEmptyString(raw.targetTitle) ?? readNonEmptyString(raw.title);
  targetSlug = resolveCanonicalTargetSlug(lookups, targetSlug, rawTitle, options.sessionPriorSlugs);

  const matchedIndexNote = lookups.bySlug.get(targetSlug);
  const mergeEnabled = options.mergeOperationEnabled ?? extractionThresholds.mergeOperationEnabled;
  let sectionPatches = readSectionPatches(raw);
  const residualRaw =
    typeof raw.residualBody === "string" && raw.residualBody.trim().length > 0
      ? raw.residualBody.trim()
      : undefined;

  let rawBody = readNonEmptyString(raw.body) ?? readNonEmptyString(raw.content) ?? "";

  if (operation === "merge" && !mergeEnabled) {
    if (!rawBody.trim() && (sectionPatches.length > 0 || residualRaw)) {
      rawBody = flattenMergeToBody(sectionPatches, residualRaw);
    } else if (rawBody.trim() && (sectionPatches.length > 0 || residualRaw)) {
      rawBody = [rawBody, flattenMergeToBody(sectionPatches, residualRaw)].filter(Boolean).join("\n\n");
    }
    sectionPatches = [];
  } else if (operation === "merge" && mergeEnabled && !rawBody.trim()) {
    if (sectionPatches.length > 0 || residualRaw) {
      rawBody = flattenMergeToBody(sectionPatches, residualRaw);
    }
  }

  let effectiveOperation: ExtractionOperation =
    operation === "merge" && !mergeEnabled ? "append" : operation;

  const normalizedLinks = normalizeLinks(raw.links ?? raw.linkedTo, lookups);
  const sanitizedBody = ensureDeclaredLinksInBody(
    sanitizeBodyLinks(rawBody, lookups),
    normalizedLinks
  );

  const summary =
    readNonEmptyString(raw.summary)?.slice(0, 240) ??
    summarizeMarkdown(sanitizedBody).slice(0, 240);

  let targetTitle = matchedIndexNote?.title ?? rawTitle ?? humanizeSlug(targetSlug);

  if (
    !(matchedIndexNote && !matchedIndexNote.isPlaceholder) &&
    isUnacceptableGenericNoteTitle(targetTitle)
  ) {
    const refined = deriveDescriptiveNoteTitle(sanitizedBody, summary, targetSlug);
    if (refined) {
      targetTitle = refined;
    }
  }

  const fallbackKind: ExtractionEvidenceKind = options.sourceType ? "source" : "transcript";
  const fallbackEvidence: ExtractionEvidence = {
    kind: fallbackKind,
    ref: options.sourcePath ?? (options.sourceType ?? "transcript")
  };

  let normalizedOperation = effectiveOperation;
  const existsAlready = lookups.existingSlugs.has(targetSlug);
  const fallbackConfidence =
    effectiveOperation === "rewrite" ? 0.75 : effectiveOperation === "noop" ? 1 : 0.58;
  const confidence = clampConfidence(raw.confidence, fallbackConfidence);

  if (normalizedOperation === "merge" && !existsAlready) {
    normalizedOperation = "create";
  }

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

  if (
    normalizedOperation === "merge" &&
    existsAlready &&
    sectionPatches.length === 0 &&
    !residualRaw
  ) {
    normalizedOperation = "append";
  }

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

  let resolvedFolderPath: string | undefined;
  if ("folderPath" in raw || "targetFolderPath" in raw) {
    const rawFolder = raw.folderPath ?? raw.targetFolderPath;
    if (typeof rawFolder === "string") {
      resolvedFolderPath = normalizeWikiFolderPath(rawFolder);
    }
  } else if (matchedIndexNote?.folderPath) {
    const fromIndex = normalizeWikiFolderPath(matchedIndexNote.folderPath);
    resolvedFolderPath = fromIndex.length > 0 ? fromIndex : undefined;
  }

  const emitMergePayload =
    mergeEnabled &&
    normalizedOperation === "merge" &&
    existsAlready &&
    (sectionPatches.length > 0 || Boolean(residualRaw));

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
      ...(resolvedFolderPath !== undefined ? { folderPath: resolvedFolderPath } : {}),
      sources: options.sourceType ? 1 : 0,
      url: options.sourceType === "web" ? options.sourcePath : undefined,
      ...(emitMergePayload
        ? {
            ...(sectionPatches.length > 0 ? { sectionPatches } : {}),
            ...(residualRaw ? { residualBody: residualRaw } : {})
          }
        : {})
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

  if (updates.some((update) => update.operation === "merge")) {
    return "merge";
  }

  if (updates.some((update) => update.operation === "create")) {
    return "create";
  }

  if (updates.some((update) => update.operation === "append")) {
    return "append";
  }

  return "noop";
}

function mergeFolderPaths(updates: ExtractionUpdate[]): string | undefined {
  for (let index = updates.length - 1; index >= 0; index -= 1) {
    const value = updates[index]?.folderPath;
    if (value !== undefined) {
      return value;
    }
  }

  return undefined;
}

function mergeGroupSectionPatches(group: ExtractionUpdate[]): {
  patches: ExtractionSectionPatch[];
  residual?: string;
} {
  const map = new Map<string, ExtractionSectionPatch>();

  for (const update of group) {
    for (const patch of update.sectionPatches ?? []) {
      map.set(normalizeHeadingKeyForPatch(patch.heading), patch);
    }
  }

  const residuals = group
    .map((update) => update.residualBody)
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0);

  return {
    patches: [...map.values()],
    residual:
      residuals.length > 0 ? residuals[residuals.length - 1]!.trim() : undefined
  };
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

    const mergedFolderPath = mergeFolderPaths(group);
    const { patches: mergedSectionPatches, residual: mergedResidual } = mergeGroupSectionPatches(group);

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
      ...(mergedFolderPath !== undefined ? { folderPath: mergedFolderPath } : {}),
      sources: Math.max(...group.map((update) => update.sources ?? 0)),
      url: [...group].reverse().find((update) => typeof update.url === "string")?.url,
      ...(operation === "merge" && (mergedSectionPatches.length > 0 || mergedResidual)
        ? {
            ...(mergedSectionPatches.length > 0 ? { sectionPatches: mergedSectionPatches } : {}),
            ...(mergedResidual ? { residualBody: mergedResidual } : {})
          }
        : {})
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
