import type {
  ChatContextReference,
  ChatModel,
  ExtractionCloudConfig,
  ExtractionRunInput,
  MessageRecord,
  SubscriptionTier
} from "@electron/ipc/types";
import type {
  ExtractionContextNote,
  ExtractionIndexEntry,
  ExtractionResponse,
  ExtractionUpdate
} from "@shared/extraction/contracts";
import type { ExtractionMode } from "@electron/ipc/types";
import { getSupabase, hasSupabaseConfig } from "./supabase";

export type { ExtractionIndexEntry, ExtractionResponse, ExtractionUpdate };

export interface IngestProgress {
  step: "reading" | "extracting" | "updating" | "done" | "error";
  message: string;
}

export type ChatNoteReference = ChatContextReference;

interface StreamChatInput {
  accessToken: string;
  subscriptionTier: SubscriptionTier;
  model: ChatModel;
  sessionId: string;
  messages: Array<Pick<MessageRecord, "role" | "content">>;
  references?: ChatNoteReference[];
  onToken: (token: string) => void;
  onStatus: (message: string) => void | Promise<void>;
  onTitle: (title: string) => void | Promise<void>;
}

interface ExtractInput {
  accessToken: string | null;
  transcript: Array<Pick<MessageRecord, "role" | "content">>;
  sessionId?: string;
  index: ExtractionIndexEntry[];
  relatedNotes?: ExtractionContextNote[];
  mode?: ExtractionMode;
  preferredLocalModelId?: string | null;
}

interface IngestExtractInput extends ExtractInput {
  sourceType: "pdf" | "web" | "text";
  sourceTitle: string;
  sourcePath: string;
  sourceContent: string;
  onProgress: (event: IngestProgress) => void;
}

export function getOptionalExtractionCloudConfig(
  accessToken: string | null
): ExtractionCloudConfig | undefined {
  const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim();
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL?.trim();

  if (!publishableKey || !supabaseUrl) {
    return undefined;
  }

  return {
    functionsBaseUrl: `${supabaseUrl}/functions/v1`,
    publishableKey,
    accessToken
  };
}

async function resolveAccessToken(fallbackToken: string): Promise<string> {
  if (!hasSupabaseConfig()) {
    return fallbackToken;
  }

  try {
    const supabase = getSupabase();
    const {
      data: { session }
    } = await supabase.auth.getSession();

    if (!session?.access_token) {
      return fallbackToken;
    }

    const expiresAtMs =
      typeof session.expires_at === "number" ? session.expires_at * 1000 : null;
    const bufferMs = 120_000;

    if (expiresAtMs !== null && Date.now() >= expiresAtMs - bufferMs) {
      const { data, error } = await supabase.auth.refreshSession();

      if (!error && data.session?.access_token) {
        return data.session.access_token;
      }
    }

    return session.access_token;
  } catch {
    return fallbackToken;
  }
}

async function runExtractionRequest(
  input: Omit<ExtractionRunInput, "cloud"> & { accessToken: string | null }
): Promise<ExtractionResponse> {
  const accessToken = await resolveAccessToken(input.accessToken ?? "");
  const { accessToken: _accessToken, ...runInput } = input;
  const result = await window.trellis.extraction.run({
    ...runInput,
    cloud: getOptionalExtractionCloudConfig(accessToken)
  });

  return result.response;
}

export async function streamChat(input: StreamChatInput): Promise<void> {
  const accessToken = await resolveAccessToken(input.accessToken);
  await window.trellis.chat.stream({
    accessToken,
    subscriptionTier: input.subscriptionTier,
    model: input.model,
    sessionId: input.sessionId,
    messages: input.messages,
    references: input.references ?? [],
    onToken: input.onToken,
    onStatus: input.onStatus,
    onTitle: input.onTitle
  });
}

export async function extractTranscript(input: ExtractInput): Promise<ExtractionResponse> {
  return runExtractionRequest({
    accessToken: input.accessToken,
    mode: input.mode,
    transcript: input.transcript,
    sessionId: input.sessionId,
    index: input.index,
    relatedNotes: input.relatedNotes ?? [],
    preferredLocalModelId: input.preferredLocalModelId ?? undefined
  });
}

export async function extractIngestedSource(
  input: IngestExtractInput
): Promise<ExtractionResponse> {
  input.onProgress({
    step: "extracting",
    message: "Shaping concepts…"
  });
  const response = await runExtractionRequest({
    accessToken: input.accessToken,
    mode: input.mode,
    index: input.index,
    sourceType: input.sourceType,
    sourceTitle: input.sourceTitle,
    sourcePath: input.sourcePath,
    sourceContent: input.sourceContent,
    relatedNotes: input.relatedNotes ?? [],
    preferredLocalModelId: input.preferredLocalModelId ?? undefined,
    transcript: [
      {
        role: "user",
        content: input.sourceContent
      }
    ]
  });
  input.onProgress({
    step: "updating",
    message: `Updating ${response.updates.length} notes…`
  });
  return response;
}
