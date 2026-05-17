import type {
  ChatContextReference,
  ChatModel,
  ChatStreamPayloadMessage,
  ExtractionRunInput,
  MessageRecord,
  SubscriptionTier
} from "@trellis/contracts";
import type {
  ExtractionContextNote,
  ExtractionIndexEntry,
  ExtractionResponse,
  ExtractionUpdate
} from "@trellis/shared/extraction/contracts";
import type { ExtractionMode } from "@trellis/contracts";
import { getTrellisApiClient } from "@/lib/cloud/client";
import { getActiveCloudWorkspaceRuntime } from "@/lib/cloud/runtime";
import { hasElectronPreloadBridge } from "@/lib/platform/runtime";
import { streamCloudChatOverHttp } from "@/lib/webCloudChatStream";
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
  messages: ChatStreamPayloadMessage[];
  /** Required for browser streaming so images can be resolved from cloud storage. */
  messageRecords?: MessageRecord[];
  references?: ChatNoteReference[];
  previewWorkspace?: boolean;
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
  /** Cloud composer-source-extract only; drives provider key selection. */
  chatModel?: string;
}

interface IngestExtractInput extends ExtractInput {
  sourceType: "pdf" | "web" | "text";
  sourceTitle: string;
  sourcePath: string;
  sourceContent: string;
  onProgress: (event: IngestProgress) => void;
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
  input: ExtractionRunInput & { accessToken: string | null }
): Promise<ExtractionResponse> {
  const isComposerIngestCloud =
    !hasElectronPreloadBridge() &&
    (input.sourceType === "pdf" ||
      input.sourceType === "web" ||
      input.sourceType === "text");

  if (isComposerIngestCloud) {
    const workspaceId = getActiveCloudWorkspaceRuntime()?.cloudWorkspaceId;
    if (!workspaceId) {
      throw new Error("Sign in to extract attached sources to Strands.");
    }

    const sourceContent =
      typeof input.sourceContent === "string" && input.sourceContent.trim().length > 0
        ? input.sourceContent
        : input.transcript[0]?.content ?? "";

    if (sourceContent.trim().length === 0) {
      throw new Error("No source content to extract.");
    }

    const sourceType = input.sourceType ?? "text";
    const sourceTitle = input.sourceTitle ?? "Source";
    const sourcePath = input.sourcePath ?? "";

    if (sourceType !== "pdf" && sourceType !== "web" && sourceType !== "text") {
      throw new Error("Invalid source type for cloud extraction.");
    }

    const chatModelStr =
      typeof input.chatModel === "string" && input.chatModel.length > 0
        ? input.chatModel
        : "gpt-4.1-mini";

    const payload = await getTrellisApiClient().runComposerSourceExtraction({
      workspaceId,
      chatModel: chatModelStr,
      sourceType,
      sourceTitle,
      sourcePath,
      sourceContent,
      relatedNotes: input.relatedNotes ?? []
    });

    return payload.extraction;
  }

  if (!hasElectronPreloadBridge()) {
    throw new Error("This extraction path requires the Trellis desktop app.");
  }

  const runInput: ExtractionRunInput = {
    mode: input.mode,
    chatModel: input.chatModel,
    sessionId: input.sessionId,
    transcript: input.transcript,
    index: input.index,
    relatedNotes: input.relatedNotes,
    sourceType: input.sourceType,
    sourceTitle: input.sourceTitle,
    sourcePath: input.sourcePath,
    sourceContent: input.sourceContent,
    preferredLocalModelId: input.preferredLocalModelId
  };
  const result = await window.trellis.extraction.run(runInput);

  return result.response;
}

export async function streamChat(input: StreamChatInput): Promise<void> {
  const accessToken = await resolveAccessToken(input.accessToken);

  if (!hasElectronPreloadBridge()) {
    if (
      !input.messageRecords ||
      input.messageRecords.length !== input.messages.length
    ) {
      throw new Error("Could not align chat messages for cloud streaming.");
    }

    await streamCloudChatOverHttp({
      accessToken,
      subscriptionTier: input.subscriptionTier,
      model: input.model,
      sessionId: input.sessionId,
      messages: input.messages,
      messageRecords: input.messageRecords,
      references: input.references ?? [],
      previewWorkspace: input.previewWorkspace,
      onToken: input.onToken,
      onStatus: input.onStatus,
      onTitle: input.onTitle
    });
    return;
  }

  await window.trellis.chat.stream({
    accessToken,
    subscriptionTier: input.subscriptionTier,
    model: input.model,
    sessionId: input.sessionId,
    messages: input.messages,
    references: input.references ?? [],
    ...(input.previewWorkspace ? { previewWorkspace: true } : {}),
    onToken: input.onToken,
    onStatus: input.onStatus,
    onTitle: input.onTitle
  });
}

/** Stream on-device embedded chat (IPC token events; same handlers as cloud `streamChat`). */
export async function streamLocalChat(input: StreamChatInput): Promise<void> {
  if (!hasElectronPreloadBridge()) {
    throw new Error("Local-only chat runs in the Trellis desktop app with an embedded model.");
  }

  await window.trellis.chat.streamLocal({
    accessToken: input.accessToken,
    subscriptionTier: input.subscriptionTier,
    model: input.model,
    sessionId: input.sessionId,
    messages: input.messages,
    references: input.references ?? [],
    ...(input.previewWorkspace ? { previewWorkspace: true } : {}),
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
    chatModel: input.chatModel,
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
