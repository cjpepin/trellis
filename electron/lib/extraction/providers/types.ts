import type {
  ExtractionContextNote,
  ExtractionIndexEntry,
  ExtractionResponse,
  ExtractionSourceType
} from "@shared/extraction/contracts";
import type {
  ExtractionProviderId,
  ExtractionProviderStatus,
  ExtractionRunResult
} from "../../../ipc/types";

export interface ProviderExtractInput {
  transcript: Array<{ role: "user" | "assistant"; content: string }>;
  sessionId?: string;
  index: ExtractionIndexEntry[];
  relatedNotes?: ExtractionContextNote[];
  sessionPriorNoteSlugs?: string[];
  sessionPriorNoteContents?: Map<string, string>;
  sourceType?: ExtractionSourceType;
  sourceTitle?: string;
  sourcePath?: string;
  sourceContent?: string;
  preferredLocalModelId?: string;
  retryThorough?: boolean;
}

export interface ExtractionProvider {
  id: ExtractionProviderId;
  getStatus(): Promise<ExtractionProviderStatus>;
  extract(input: ProviderExtractInput): Promise<ExtractionRunResult>;
}

export interface ProviderValidationResult {
  response: ExtractionResponse;
  provider: ExtractionProviderId;
  model: string | null;
}
