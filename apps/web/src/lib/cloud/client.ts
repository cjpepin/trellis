import type {
  ApplyBucketOrganizeResult,
  ChatContextReference,
  ChatNoteActionProposal,
  ChatPrivacyMode,
  CheckoutPlanCode,
  NoteType,
  ProposeChatNoteActionsResult
} from "@trellis/contracts";
import type { ExtractionContextNote } from "@trellis/shared/extraction/contracts";
import type {
  CloudBootstrapResponse,
  CloudChatMessage,
  CloudChatRetrievalRequest,
  CloudChatRetrievalResponse,
  CloudChatSessionSummary,
  CloudChatMessageWriteInput,
  CloudCreateFolderInput,
  CloudDeleteNoteInput,
  CloudDeleteFolderInput,
  CloudGraphData,
  CloudMigrationImportRequest,
  CloudMigrationImportResponse,
  CloudNote,
  CloudNoteRevisionSummary,
  CloudPatchUserPreferencesInput,
  CloudProviderCredentialStatus,
  CloudProviderCredentialWriteInput,
  CloudReplaceChatMessagesInput,
  CloudRenameFolderInput,
  CloudSessionExtractionResponse,
  CloudUpsertChatSessionInput,
  CloudUpsertNoteInput,
  CloudUserPreferences
} from "@trellis/shared/cloud/types";
import { getSupabase, hasSupabaseConfig } from "@/lib/supabase";

const functionsBaseUrl = `${import.meta.env.VITE_SUPABASE_URL?.trim() ?? ""}/functions/v1`;
const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim() ?? "";

async function getAccessToken(): Promise<string> {
  if (!hasSupabaseConfig()) {
    throw new Error("Cloud features are not configured for this build yet.");
  }

  const {
    data: { session }
  } = await getSupabase().auth.getSession();

  if (!session?.access_token) {
    throw new Error("Sign in before using cloud-backed Trellis APIs.");
  }

  return session.access_token;
}

function buildHeaders(accessToken: string, includeJsonContentType = false): HeadersInit {
  return {
    ...(includeJsonContentType ? { "Content-Type": "application/json" } : {}),
    apikey: publishableKey,
    Authorization: `Bearer ${accessToken}`
  };
}

async function readJsonResponse<T>(response: Response, fallbackMessage: string): Promise<T> {
  if (!response.ok) {
    let message = fallbackMessage;

    try {
      const payload = (await response.json()) as {
        error?: string;
        message?: string;
        code?: string;
      };
      if (typeof payload.error === "string" && payload.error.length > 0) {
        message = payload.error;
      } else if (typeof payload.message === "string" && payload.message.length > 0) {
        message =
          typeof payload.code === "string" && payload.code.length > 0
            ? `${payload.message} (${payload.code})`
            : payload.message;
      }
    } catch {
      const text = await response.text();
      if (text.trim().length > 0) {
        message = text.trim();
      }
    }

    throw new Error(message);
  }

  return (await response.json()) as T;
}

async function invokeCloudFunction<T>(
  path: string,
  init: RequestInit,
  fallbackMessage: string
): Promise<T> {
  const accessToken = await getAccessToken();
  const response = await fetch(`${functionsBaseUrl}/${path}`, {
    ...init,
    headers: {
      ...buildHeaders(accessToken, init.body !== undefined),
      ...(init.headers ?? {})
    }
  });

  return readJsonResponse<T>(response, fallbackMessage);
}

export class TrellisApiClient {
  async bootstrap(workspaceId?: string): Promise<CloudBootstrapResponse> {
    const query = workspaceId ? `?workspace_id=${encodeURIComponent(workspaceId)}` : "";
    return invokeCloudFunction<CloudBootstrapResponse>(
      `app-bootstrap${query}`,
      { method: "GET" },
      "Could not load cloud workspace state."
    );
  }

  async listNotes(workspaceId: string): Promise<CloudNote[]> {
    const query = `?workspace_id=${encodeURIComponent(workspaceId)}`;
    return invokeCloudFunction<CloudNote[]>(
      `notes${query}`,
      { method: "GET" },
      "Could not list notes."
    );
  }

  async listChatSessions(workspaceId: string): Promise<CloudChatSessionSummary[]> {
    const query = `?workspace_id=${encodeURIComponent(workspaceId)}`;
    return invokeCloudFunction<CloudChatSessionSummary[]>(
      `chat-data${query}`,
      { method: "GET" },
      "Could not list chat sessions."
    );
  }

  async getChatMessages(workspaceId: string, sessionId: string): Promise<CloudChatMessage[]> {
    const query = `?workspace_id=${encodeURIComponent(workspaceId)}&session_id=${encodeURIComponent(sessionId)}`;
    return invokeCloudFunction<CloudChatMessage[]>(
      `chat-data${query}`,
      { method: "GET" },
      "Could not load that chat session."
    );
  }

  async saveChatSession(input: CloudUpsertChatSessionInput): Promise<CloudChatSessionSummary> {
    return invokeCloudFunction<CloudChatSessionSummary>(
      "chat-data",
      {
        method: "POST",
        body: JSON.stringify(input)
      },
      "Could not save that chat session."
    );
  }

  async replaceChatMessages(input: CloudReplaceChatMessagesInput): Promise<CloudChatSessionSummary> {
    return invokeCloudFunction<CloudChatSessionSummary>(
      "chat-data",
      {
        method: "PUT",
        body: JSON.stringify(input)
      },
      "Could not save chat messages."
    );
  }

  async deleteChatSession(workspaceId: string, sessionId: string): Promise<void> {
    const query =
      `?workspace_id=${encodeURIComponent(workspaceId)}` +
      `&session_id=${encodeURIComponent(sessionId)}`;
    await invokeCloudFunction<{ ok: boolean }>(
      `chat-data${query}`,
      { method: "DELETE" },
      "Could not delete that chat session."
    );
  }

  async getNote(workspaceId: string, slug: string): Promise<CloudNote> {
    const query = `?workspace_id=${encodeURIComponent(workspaceId)}&slug=${encodeURIComponent(slug)}`;
    return invokeCloudFunction<CloudNote>(
      `notes${query}`,
      { method: "GET" },
      "Could not load that note."
    );
  }

  async saveNote(input: CloudUpsertNoteInput): Promise<CloudNote> {
    return invokeCloudFunction<CloudNote>(
      "notes",
      {
        method: "POST",
        body: JSON.stringify(input)
      },
      "Could not save that note."
    );
  }

  async runChatRetrieval(input: CloudChatRetrievalRequest): Promise<CloudChatRetrievalResponse> {
    return invokeCloudFunction<CloudChatRetrievalResponse>(
      "chat-retrieval",
      {
        method: "POST",
        body: JSON.stringify(input)
      },
      "Could not build chat context."
    );
  }

  async listNoteRevisions(workspaceId: string, slug: string): Promise<CloudNoteRevisionSummary[]> {
    const query = `?workspace_id=${encodeURIComponent(workspaceId)}&slug=${encodeURIComponent(slug)}`;
    return invokeCloudFunction<CloudNoteRevisionSummary[]>(
      `note-revisions${query}`,
      { method: "GET" },
      "Could not load strand history."
    );
  }

  async getNoteRevisionBody(workspaceId: string, revisionId: string): Promise<{ body: string } | null> {
    const query = `?workspace_id=${encodeURIComponent(workspaceId)}&revision_id=${encodeURIComponent(revisionId)}`;
    try {
      return await invokeCloudFunction<{ body: string }>(
        `note-revisions${query}`,
        { method: "GET" },
        "Could not load that revision."
      );
    } catch {
      return null;
    }
  }

  async deleteNote(input: CloudDeleteNoteInput): Promise<{ ok: boolean }> {
    return invokeCloudFunction<{ ok: boolean }>(
      "notes",
      {
        method: "DELETE",
        body: JSON.stringify(input)
      },
      "Could not delete that note."
    );
  }

  async createFolder(input: CloudCreateFolderInput): Promise<{ ok: boolean; path: string }> {
    return invokeCloudFunction<{ ok: boolean; path: string }>(
      "folders",
      {
        method: "POST",
        body: JSON.stringify(input)
      },
      "Could not create that folder."
    );
  }

  async renameFolder(input: CloudRenameFolderInput): Promise<{ ok: boolean; path: string }> {
    return invokeCloudFunction<{ ok: boolean; path: string }>(
      "folders",
      {
        method: "PATCH",
        body: JSON.stringify(input)
      },
      "Could not rename that folder."
    );
  }

  async deleteFolder(input: CloudDeleteFolderInput): Promise<{ ok: boolean }> {
    return invokeCloudFunction<{ ok: boolean }>(
      "folders",
      {
        method: "DELETE",
        body: JSON.stringify(input)
      },
      "Could not delete that folder."
    );
  }

  async getGraph(workspaceId: string): Promise<CloudGraphData> {
    const query = `?workspace_id=${encodeURIComponent(workspaceId)}`;
    return invokeCloudFunction<CloudGraphData>(
      `graph${query}`,
      { method: "GET" },
      "Could not load the workspace graph."
    );
  }

  async listProviderCredentialStatuses(): Promise<CloudProviderCredentialStatus[]> {
    return invokeCloudFunction<CloudProviderCredentialStatus[]>(
      "provider-credentials",
      { method: "GET" },
      "Could not load provider key status."
    );
  }

  async saveProviderCredential(
    input: CloudProviderCredentialWriteInput
  ): Promise<CloudProviderCredentialStatus[]> {
    return invokeCloudFunction<CloudProviderCredentialStatus[]>(
      "provider-credentials",
      {
        method: "POST",
        body: JSON.stringify(input)
      },
      "Could not save that provider key."
    );
  }

  async deleteProviderCredential(provider: CloudProviderCredentialWriteInput["provider"]) {
    const query = `?provider=${encodeURIComponent(provider)}`;
    return invokeCloudFunction<CloudProviderCredentialStatus[]>(
      `provider-credentials${query}`,
      { method: "DELETE" },
      "Could not delete that provider key."
    );
  }

  async patchUserPreferences(input: CloudPatchUserPreferencesInput): Promise<CloudUserPreferences> {
    return invokeCloudFunction<CloudUserPreferences>(
      "user-preferences",
      {
        method: "PATCH",
        body: JSON.stringify(input)
      },
      "Could not save your preferences."
    );
  }

  async runCloudSessionExtraction(input: {
    workspaceId: string;
    sessionId: string;
    retryThorough?: boolean;
  }): Promise<CloudSessionExtractionResponse> {
    return invokeCloudFunction<CloudSessionExtractionResponse>(
      "chat-session-extract",
      {
        method: "POST",
        body: JSON.stringify(input)
      },
      "Could not extract Strands for that chat."
    );
  }

  async runComposerSourceExtraction(input: {
    workspaceId: string;
    chatModel: string;
    sourceType: "pdf" | "web" | "text";
    sourceTitle: string;
    sourcePath: string;
    sourceContent: string;
    relatedNotes: ExtractionContextNote[];
  }): Promise<CloudSessionExtractionResponse> {
    return invokeCloudFunction<CloudSessionExtractionResponse>(
      "composer-source-extract",
      {
        method: "POST",
        body: JSON.stringify(input)
      },
      "Could not extract Strands from that attachment."
    );
  }

  async importMigrationSnapshot(
    input: CloudMigrationImportRequest
  ): Promise<CloudMigrationImportResponse> {
    return invokeCloudFunction<CloudMigrationImportResponse>(
      "migration-import",
      {
        method: "POST",
        body: JSON.stringify(input)
      },
      "Could not import the migration snapshot."
    );
  }

  async createCheckoutSession(plan: CheckoutPlanCode): Promise<{ url: string }> {
    return invokeCloudFunction<{ url: string }>(
      "checkout",
      {
        method: "POST",
        body: JSON.stringify({ plan })
      },
      "Could not start checkout."
    );
  }

  async proposeChatNoteActions(input: {
    workspaceId: string;
    mode: ChatPrivacyMode;
    phase?: "pre_response" | "post_response";
    activeNoteSlug?: string | null;
    pinnedNoteSlugs?: string[];
    messages: Array<{ id: string; role: "user" | "assistant"; content: string }>;
  }): Promise<ProposeChatNoteActionsResult> {
    interface RawAction {
      id: string;
      kind: ChatNoteActionProposal["kind"];
      status: "pending";
      createdAt: number;
      targetTitle: string;
      targetSlug: string;
      targetFolderPath: string;
      beforeMarkdown: string;
      afterMarkdown: string;
      frontmatter: { tags?: string[]; type?: string; sources?: number };
      rationale: string;
      sourceMessageIds: string[];
    }

    const raw = await invokeCloudFunction<{ actions: RawAction[]; clarification: string | null }>(
      "chat-note-actions",
      {
        method: "POST",
        body: JSON.stringify(input)
      },
      "Could not prepare note actions."
    );

    const createdIso = new Date().toISOString();
    const actions: ChatNoteActionProposal[] = raw.actions.map((action) => ({
      id: action.id,
      kind: action.kind,
      status: action.status,
      createdAt: action.createdAt,
      targetTitle: action.targetTitle,
      targetSlug: action.targetSlug,
      targetFolderPath: action.targetFolderPath,
      beforeMarkdown: action.beforeMarkdown,
      afterMarkdown: action.afterMarkdown,
      frontmatter: {
        title: action.targetTitle,
        created: createdIso,
        updated: createdIso,
        sources: action.frontmatter.sources ?? 0,
        tags: action.frontmatter.tags ?? [],
        type: (action.frontmatter.type ?? "concept") as NoteType
      },
      rationale: action.rationale,
      sourceMessageIds: action.sourceMessageIds
    }));

    return {
      actions,
      clarification: raw.clarification
    };
  }

  async storeChatMemoryTurn(input: {
    workspaceId: string;
    messages: Array<{ id: string; role: "user" | "assistant"; content: string }>;
    references?: ChatContextReference[];
  }): Promise<void> {
    await invokeCloudFunction<{ ok: boolean }>(
      "chat-memory-turn",
      {
        method: "POST",
        body: JSON.stringify(input)
      },
      "Could not save memory."
    );
  }

  async applyChatBucketOrganize(input: {
    workspaceId: string;
    userMessage: string;
  }): Promise<ApplyBucketOrganizeResult> {
    return invokeCloudFunction<ApplyBucketOrganizeResult>(
      "chat-bucket-organize",
      {
        method: "POST",
        body: JSON.stringify(input)
      },
      "Could not organize the bucket."
    );
  }

  async thoughtEnrich(input: { workspaceId: string; thoughtId: string }): Promise<{ ok: boolean }> {
    return invokeCloudFunction<{ ok: boolean }>(
      "thought-enrich",
      {
        method: "POST",
        body: JSON.stringify(input)
      },
      "Could not enrich that thought."
    );
  }

  async requestAccountSoftDelete(input: {
    email_confirmation: string;
    password: string;
  }): Promise<{ ok: boolean; deleted_at: string }> {
    return invokeCloudFunction<{ ok: boolean; deleted_at: string }>(
      "account-soft-delete",
      {
        method: "POST",
        body: JSON.stringify(input)
      },
      "Could not schedule account deletion."
    );
  }

  async recoverAccount(input: { password: string }): Promise<{
    ok: boolean;
    recovered_at: string;
    stripe_resumed: boolean;
  }> {
    return invokeCloudFunction<{
      ok: boolean;
      recovered_at: string;
      stripe_resumed: boolean;
    }>(
      "account-recover",
      {
        method: "POST",
        body: JSON.stringify(input)
      },
      "Could not recover your account."
    );
  }

  async abandonAccountDeletion(input: {
    password: string;
    email_confirmation: string;
    confirm_abandon: boolean;
  }): Promise<{ ok: boolean }> {
    return invokeCloudFunction<{ ok: boolean }>(
      "account-abandon-deletion",
      {
        method: "POST",
        body: JSON.stringify(input)
      },
      "Could not finalize account deletion."
    );
  }
}

let defaultClient: TrellisApiClient | null = null;

export function getTrellisApiClient(): TrellisApiClient {
  if (!defaultClient) {
    defaultClient = new TrellisApiClient();
  }

  return defaultClient;
}
