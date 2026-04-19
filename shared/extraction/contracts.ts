export const extractionNoteTypeValues = [
  "concept",
  "entity",
  "source-summary",
  "synthesis"
] as const;

export type ExtractionNoteType = (typeof extractionNoteTypeValues)[number];

export const extractionOperationValues = [
  "create",
  "append",
  "rewrite",
  "merge",
  "noop"
] as const;

export type ExtractionOperation = (typeof extractionOperationValues)[number];

export const extractionEvidenceKindValues = [
  "transcript",
  "source",
  "note"
] as const;

export type ExtractionEvidenceKind = (typeof extractionEvidenceKindValues)[number];

export type ExtractionSourceType = "pdf" | "web" | "text";

export type ExtractionSectionPatchMode = "replace" | "merge-bullets";

export interface ExtractionSectionPatch {
  /** Heading line text to match in the existing note (`## Schedule`); compared with normalizeHeadingForMatch. */
  heading: string;
  /** New body for that section without the heading line. */
  body: string;
  mode: ExtractionSectionPatchMode;
}

export interface ExtractionIndexEntry {
  slug: string;
  title: string;
  tags: string[];
  /** Wiki subfolder path under `wiki/` (POSIX, no leading slash). Empty = root. */
  folderPath?: string;
  isPlaceholder?: boolean;
}

export interface ExtractionEvidence {
  kind: ExtractionEvidenceKind;
  ref: string;
  summary?: string;
}

export interface ExtractionContextNote {
  slug: string;
  title: string;
  tags: string[];
  headingPath: string;
  content: string;
  score: number;
  isExplicitMatch?: boolean;
  /** ISO date from vault frontmatter when available (staleness signal for extraction). */
  updatedAt?: string;
}

export interface ExtractionUpdate {
  operation: ExtractionOperation;
  targetSlug: string;
  targetTitle: string;
  targetType: ExtractionNoteType;
  summary: string;
  body: string;
  tags: string[];
  links: string[];
  evidence: ExtractionEvidence[];
  confidence: number;
  /** When set, place or move the note under this wiki folder (POSIX path, root = empty). */
  folderPath?: string;
  sources?: number;
  url?: string;
  /** Present when operation === "merge": replace or merge bullets under these headings. */
  sectionPatches?: ExtractionSectionPatch[];
  /** Optional markdown appended when patches do not cover everything (or skipped headings). */
  residualBody?: string;
}

export interface ExtractionResponse {
  updates: ExtractionUpdate[];
  sessionTitle: string;
}

export interface ExtractionValidationIssue {
  path: string;
  message: string;
}

export interface ExtractionValidationOptions {
  index?: ExtractionIndexEntry[];
  sourceType?: ExtractionSourceType;
  sourcePath?: string;
  sessionPriorSlugs?: string[];
  /** When false, `merge` updates are coerced to `append` with a flattened body. */
  mergeOperationEnabled?: boolean;
}

export interface ExtractionValidationResult {
  value: ExtractionResponse | null;
  issues: ExtractionValidationIssue[];
}
