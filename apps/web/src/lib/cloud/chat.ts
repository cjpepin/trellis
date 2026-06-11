import type {
  ApplyBucketOrganizeInput,
  ApplyBucketOrganizeResult,
  ChatModel,
  ChatSessionSummary,
  MessageRecord,
  ProposeChatNoteActionsInput,
  ProposeChatNoteActionsResult,
  StoreChatMemoryInput
} from "@trellis/contracts";
import type { JsonObject, JsonValue } from "@trellis/shared/cloud/types";
import {
  cloudChatMessageToRecord,
  cloudChatSessionToSummary
} from "@/lib/cloud/adapters";
import { getTrellisApiClient } from "@/lib/cloud/client";
import { ensureCloudWorkspaceId, getActiveCloudWorkspaceRuntime } from "@/lib/cloud/runtime";
import { withUploadedNoteAssets } from "@/lib/cloud/uploadNoteAssetsForMessages";
import { mergeChatSessionSummaries } from "@/lib/cloud/mergeLocalFirst";
import { hasElectronPreloadBridge } from "@/lib/platform/runtime";
import { isDemoMode } from "@/lib/demo/config";
import { useChatStore } from "@/store/chatStore";

function getCloudWorkspaceId(): string | null {
  return getActiveCloudWorkspaceRuntime()?.cloudWorkspaceId ?? null;
}

/**
 * Resolves the cloud workspace UUID for bridged calls, or `null` when the desktop should use IPC.
 * On web, lazily runs `app-bootstrap` if `App` has not populated the runtime yet (avoids IPC stubs).
 */
async function resolveBridgedCloudWorkspaceId(): Promise<string | null> {
  if (isDemoMode()) {
    return null;
  }
  const cached = getCloudWorkspaceId();
  if (cached) {
    return cached;
  }
  if (hasElectronPreloadBridge()) {
    return null;
  }
  return ensureCloudWorkspaceId();
}

export function isCloudBackedChatActive(): boolean {
  return getCloudWorkspaceId() !== null;
}

export async function proposeChatNoteActionsBridged(
  input: ProposeChatNoteActionsInput
): Promise<ProposeChatNoteActionsResult> {
  const cloudWorkspaceId = await resolveBridgedCloudWorkspaceId();

  if (cloudWorkspaceId) {
    return getTrellisApiClient().proposeChatNoteActions({
      workspaceId: cloudWorkspaceId,
      mode: input.mode,
      phase: input.phase,
      activeNoteSlug: input.activeNoteSlug ?? null,
      pinnedNoteSlugs: input.pinnedNoteSlugs,
      messages: input.messages.map((message) => ({
        id: message.id,
        role: message.role,
        content: message.content
      }))
    });
  }

  return window.trellis.chat.proposeNoteActions(input);
}

export async function storeChatTurnMemoryBridged(input: StoreChatMemoryInput): Promise<void> {
  const cloudWorkspaceId = await resolveBridgedCloudWorkspaceId();

  if (cloudWorkspaceId) {
    await getTrellisApiClient().storeChatMemoryTurn({
      workspaceId: cloudWorkspaceId,
      messages: input.messages,
      references: input.references
    });
    return;
  }

  await window.trellis.chat.storeMemory(input);
}

export async function applyBucketOrganizeBridged(
  input: ApplyBucketOrganizeInput
): Promise<ApplyBucketOrganizeResult> {
  const cloudWorkspaceId = await resolveBridgedCloudWorkspaceId();

  if (cloudWorkspaceId) {
    return getTrellisApiClient().applyChatBucketOrganize({
      workspaceId: cloudWorkspaceId,
      userMessage: input.userMessage
    });
  }

  return window.trellis.chat.applyBucketOrganize(input);
}

function getCurrentSession(sessionId: string): ChatSessionSummary | null {
  return useChatStore.getState().sessions.find((session) => session.id === sessionId) ?? null;
}

export async function listChatSessions(bucketId: string): Promise<ChatSessionSummary[]> {
  const cloudWorkspaceId = await resolveBridgedCloudWorkspaceId();

  if (!cloudWorkspaceId) {
    return window.trellis.db.listSessions();
  }

  const cloudRows = await getTrellisApiClient().listChatSessions(cloudWorkspaceId);
  const fromCloud = cloudRows.map((session) => cloudChatSessionToSummary(session, bucketId));
  if (hasElectronPreloadBridge()) {
    const local = await window.trellis.db.listSessions();
    return mergeChatSessionSummaries(
      local.filter((session) => session.bucketId === bucketId),
      fromCloud
    );
  }
  return fromCloud;
}

export async function createChatSession(input: {
  model: ChatModel;
  bucketId: string;
}): Promise<ChatSessionSummary> {
  const cloudWorkspaceId = await resolveBridgedCloudWorkspaceId();

  if (!cloudWorkspaceId) {
    return window.trellis.db.createSession(input);
  }

  const nowIso = new Date().toISOString();
  const session = await getTrellisApiClient().saveChatSession({
    workspaceId: cloudWorkspaceId,
    id: crypto.randomUUID(),
    title: "Untitled Session",
    model: input.model,
    messageCount: 0,
    createdAt: nowIso,
    updatedAt: nowIso
  });

  return cloudChatSessionToSummary(session, input.bucketId);
}

export async function getChatMessages(sessionId: string): Promise<MessageRecord[]> {
  const cloudWorkspaceId = await resolveBridgedCloudWorkspaceId();

  if (!cloudWorkspaceId) {
    return window.trellis.db.getMessages(sessionId);
  }

  if (hasElectronPreloadBridge()) {
    const local = await window.trellis.db.getMessages(sessionId);
    if (local.length > 0) {
      return local;
    }
  }

  const messages = await getTrellisApiClient().getChatMessages(cloudWorkspaceId, sessionId);
  return messages.map(cloudChatMessageToRecord);
}

export async function replaceChatMessages(input: {
  sessionId: string;
  messages: MessageRecord[];
}): Promise<void> {
  const cloudWorkspaceId = await resolveBridgedCloudWorkspaceId();

  if (!cloudWorkspaceId) {
    return window.trellis.db.replaceMessages(input);
  }

  const current = getCurrentSession(input.sessionId);
  if (!current) {
    throw new Error(`Unknown session: ${input.sessionId}`);
  }

  const nextMessageCount =
    input.messages.length > 0 ? input.messages.length : current.messageCount;
  const nowMs = Date.now();

  await getTrellisApiClient().saveChatSession({
    workspaceId: cloudWorkspaceId,
    id: current.id,
    title: current.title,
    model: current.model,
    messageCount: nextMessageCount,
    createdAt: new Date(current.createdAt).toISOString(),
    updatedAt: new Date(Math.max(current.updatedAt, nowMs)).toISOString()
  });

  const messagesWithAssets = await withUploadedNoteAssets(
    cloudWorkspaceId,
    input.sessionId,
    input.messages
  );

  const persistedSession = await getTrellisApiClient().replaceChatMessages({
    workspaceId: cloudWorkspaceId,
    sessionId: input.sessionId,
    messages: messagesWithAssets.map((message) => ({
      id: message.id,
      role: message.role,
      content: message.content,
      createdAt: new Date(message.createdAt).toISOString(),
      tokens: message.tokens,
      attachments: (message.attachments ?? []) as unknown as JsonValue[],
      mediaArtifacts: (message.mediaArtifacts ?? []) as unknown as JsonValue[],
      noteActions: (message.noteActions ?? []) as unknown as JsonValue[],
      replyContext: (message.replyContext ?? null) as unknown as JsonObject | null,
      composerPins: (message.composerPins ?? []) as unknown as JsonValue[]
    }))
  });

  useChatStore.getState().replaceSessionMessages(input.sessionId, messagesWithAssets);

  useChatStore.getState().upsertSession(
    cloudChatSessionToSummary(persistedSession, current.bucketId)
  );
}

export async function deleteChatSession(sessionId: string): Promise<void> {
  const cloudWorkspaceId = await resolveBridgedCloudWorkspaceId();
  const isDesktop = hasElectronPreloadBridge();

  if (cloudWorkspaceId) {
    try {
      await getTrellisApiClient().deleteChatSession(cloudWorkspaceId, sessionId);
    } catch (error) {
      if (!isDesktop) {
        throw error;
      }
      console.warn("Cloud delete session failed; removing local copy if present.", error);
    }
  }

  if (!cloudWorkspaceId || isDesktop) {
    await window.trellis.db.deleteSession(sessionId);
  }
}

export async function updateChatSession(
  payload: Partial<ChatSessionSummary> & { id: string }
): Promise<ChatSessionSummary> {
  const cloudWorkspaceId = await resolveBridgedCloudWorkspaceId();

  if (!cloudWorkspaceId) {
    return window.trellis.db.updateSession(payload);
  }

  const current = getCurrentSession(payload.id);

  if (!current) {
    throw new Error(`Unknown session: ${payload.id}`);
  }

  const currentMessages = useChatStore.getState().messagesBySession[payload.id] ?? [];
  const messageCount =
    payload.messageCount ??
    (currentMessages.length > 0 ? currentMessages.length : current.messageCount);

  const session = await getTrellisApiClient().saveChatSession({
    workspaceId: cloudWorkspaceId,
    id: payload.id,
    title: payload.title ?? current.title,
    model: payload.model ?? current.model,
    messageCount,
    createdAt: new Date(payload.createdAt ?? current.createdAt).toISOString(),
    updatedAt: new Date(payload.updatedAt ?? Date.now()).toISOString()
  });

  return cloudChatSessionToSummary(session, payload.bucketId ?? current.bucketId);
}
