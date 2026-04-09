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

export interface ExtractionIndexEntry {
  slug: string;
  title: string;
  tags: string[];
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
  sources?: number;
  url?: string;
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
}

export interface ExtractionValidationResult {
  value: ExtractionResponse | null;
  issues: ExtractionValidationIssue[];
}
