import type {
  ExtractionContextNote,
  ExtractionIndexEntry,
  ExtractionResponse,
  ExtractionSourceType
} from "@shared/extraction/contracts";
import type {
  ExtractionCloudConfig,
  ExtractionProviderId,
  ExtractionProviderStatus,
  ExtractionRunResult
} from "../../../ipc/types";

export interface ProviderExtractInput {
  transcript: Array<{ role: "user" | "assistant"; content: string }>;
  sessionId?: string;
  index: ExtractionIndexEntry[];
  relatedNotes?: ExtractionContextNote[];
  sourceType?: ExtractionSourceType;
  sourceTitle?: string;
  sourcePath?: string;
  sourceContent?: string;
  cloud?: ExtractionCloudConfig;
  preferredLocalModelId?: string;
}

export interface ExtractionProvider {
  id: ExtractionProviderId;
  getStatus(input: { cloud?: ExtractionCloudConfig }): Promise<ExtractionProviderStatus>;
  extract(input: ProviderExtractInput): Promise<ExtractionRunResult>;
}

export interface ProviderValidationResult {
  response: ExtractionResponse;
  provider: ExtractionProviderId;
  model: string | null;
}
