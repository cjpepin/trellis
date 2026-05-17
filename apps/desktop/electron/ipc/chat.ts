import { ipcMain } from "electron";
import { z } from "zod";
import type {
  AppSettings,
  AppWorkspaceId,
  ApplyBucketOrganizeInput,
  BuildChatContextInput,
  ChatStreamPayloadMessage,
  ChatStreamRequest,
  ChatProvider,
  DeleteProviderKeyInput,
  LocalChatRunInput,
  ProposeChatNoteActionsInput,
  SetProviderKeyInput,
  StoreChatMemoryInput
} from "./types";
import { chatModelIds, ipcChannels, isAppPreviewWorkspace } from "./types";
import { buildChatContextPacket } from "../lib/chat/context";
import { proposeChatNoteActions } from "../lib/chat/noteActions";
import { executeBucketOrganize } from "../lib/chat/bucketOrganize";
import { storeTurnMemory } from "../lib/chat/memory";
import { runLocalChatReply, runLocalChatReplyStream } from "../lib/chat/local";
import {
  deleteProviderKey,
  getProviderKeyStatusSnapshot,
  resolveProviderApiKey,
  setProviderKey
} from "../lib/providerKeys";
import { readMediaCacheBase64ForApi } from "../lib/chatMediaCache";
import { formatTrialQuotaChatError } from "@trellis/shared/billing/trialMessageWindow";

const messageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().max(500_000)
});

const messageWithIdSchema = messageSchema.extend({
  id: z.string().uuid()
});

const chatContextReferenceSchema = z.object({
  type: z.enum(["note", "memory"]),
  title: z.string().min(1),
  excerpt: z.string(),
  content: z.string().min(1),
  tags: z.array(z.string()).optional(),
  slug: z.string().min(1).optional(),
  linkedNoteSlug: z.string().min(1).nullable().optional(),
  isExplicitMatch: z.boolean().optional()
});

const buildChatContextSchema = z.object({
  mode: z.enum(["auto", "off", "local"]),
  bucketId: z.string().min(1).optional(),
  activeNoteSlug: z.string().min(1).nullable().optional(),
  sessionTitle: z.string().min(1).nullable().optional(),
  currentSessionId: z.string().uuid().nullable().optional(),
  pinnedNoteSlugs: z.array(z.string().min(1)).optional(),
  messages: z.array(messageSchema).min(1)
});

const storeChatMemorySchema = z.object({
  bucketId: z.string().min(1).optional(),
  sessionId: z.string().uuid().optional(),
  messages: z.array(messageWithIdSchema).min(1),
  references: z.array(chatContextReferenceSchema).optional()
});

const runLocalReplySchema = z.object({
  model: z.enum(chatModelIds),
  messages: z.array(messageSchema).min(1),
  references: z.array(chatContextReferenceSchema).optional()
});

const proposeNoteActionsMessageSchema = messageSchema.extend({
  id: z.string().uuid()
});

const proposeNoteActionsSchema = z.object({
  mode: z.enum(["auto", "off", "local"]),
  phase: z.enum(["pre_response", "post_response"]).optional(),
  bucketId: z.string().min(1).optional(),
  activeNoteSlug: z.string().min(1).nullable().optional(),
  pinnedNoteSlugs: z.array(z.string().min(1)).max(24).optional(),
  messages: z.array(proposeNoteActionsMessageSchema).min(1)
});

const applyBucketOrganizeSchema = z.object({
  bucketId: z.string().min(1),
  userMessage: z.string().min(1).max(500_000)
});

const providerKeyInputSchema = z.object({
  provider: z.enum(["openai", "anthropic"]),
  apiKey: z.string().min(1)
});

const deleteProviderKeySchema = z.object({
  provider: z.enum(["openai", "anthropic"])
});

const chatStreamPayloadMessageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().max(500_000),
  imageFileIds: z.array(z.string().uuid()).max(4).optional()
});

const chatStreamRequestSchema = z.object({
  requestId: z.string().uuid(),
  accessToken: z.string().min(1),
  subscriptionTier: z.enum(["trial", "byok", "pro"]),
  model: z.enum(chatModelIds),
  sessionId: z.string().uuid(),
  messages: z.array(chatStreamPayloadMessageSchema).min(1),
  references: z.array(chatContextReferenceSchema).optional(),
  previewWorkspace: z.boolean().optional()
});

const chatStreamLocalRequestSchema = z.object({
  requestId: z.string().uuid(),
  model: z.enum(chatModelIds),
  sessionId: z.string().uuid(),
  messages: z.array(chatStreamPayloadMessageSchema).min(1),
  references: z.array(chatContextReferenceSchema).optional()
});

async function enrichStreamMessagesForEdge(
  messages: ChatStreamPayloadMessage[]
): Promise<
  Array<{
    role: "user" | "assistant";
    content: string;
    imageParts?: Array<{ mimeType: string; dataBase64: string }>;
  }>
> {
  const out: Array<{
    role: "user" | "assistant";
    content: string;
    imageParts?: Array<{ mimeType: string; dataBase64: string }>;
  }> = [];

  for (const message of messages) {
    if (message.role !== "user" || !message.imageFileIds || message.imageFileIds.length === 0) {
      out.push({ role: message.role, content: message.content });
      continue;
    }

    const imageParts: Array<{ mimeType: string; dataBase64: string }> = [];

    for (const fileId of message.imageFileIds) {
      const part = await readMediaCacheBase64ForApi(fileId);

      if (!part) {
        throw new Error(
          "Trellis could not read an attached image from the local cache. Try attaching the image again."
        );
      }

      imageParts.push({ mimeType: part.mimeType, dataBase64: part.dataBase64 });
    }

    out.push({ role: message.role, content: message.content, imageParts });
  }

  return out;
}

function getFunctionsBaseUrl(): string {
  const supabaseUrl = process.env.VITE_SUPABASE_URL?.trim();

  if (!supabaseUrl) {
    throw new Error("Cloud features are not configured for this build yet.");
  }

  return `${supabaseUrl}/functions/v1`;
}

function getPublishableKey(): string {
  const publishableKey = process.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim();

  if (!publishableKey) {
    throw new Error("Cloud features are not configured for this build yet.");
  }

  return publishableKey;
}

async function readFunctionError(response: Response, fallbackMessage: string): Promise<Error> {
  const text = await response.text();

  try {
    const payload = JSON.parse(text) as {
      error?: string;
      message?: string;
      reset_at?: string;
    };

    if (payload.error === "subscription_expired") {
      return new Error(
        "Your subscription is no longer active. Open Settings to review plans and continue chatting."
      );
    }

    if (payload.error === "message_quota_exceeded") {
      const resetAt = typeof payload.reset_at === "string" ? payload.reset_at : null;
      return new Error(formatTrialQuotaChatError(resetAt));
    }

    if (payload.error === "trial_expired") {
      return new Error(
        "Your trial or free message allowance is no longer available. Open Settings to review plans and continue chatting."
      );
    }

    if (response.status === 401) {
      return new Error(
        "Trellis couldn't verify your cloud session. Your local notes are still safe. Sign in again from Settings to resume chatting."
      );
    }

    if (typeof payload.error === "string" && payload.error.length > 0) {
      return new Error(payload.error);
    }

    if (typeof payload.message === "string" && payload.message.length > 0) {
      return new Error(payload.message);
    }
  } catch {
    if (text.length > 0) {
      return new Error(text);
    }
  }

  return new Error(fallbackMessage);
}

async function readSseStream(
  response: Response,
  onEvent: (type: "status" | "token" | "title" | "done", payload: string) => void
): Promise<void> {
  const reader = response.body?.getReader();

  if (!reader) {
    throw new Error("Streaming response had no body.");
  }

  const decoder = new TextDecoder();
  let buffer = "";

  function readDataValue(line: string): string {
    const rawValue = line.slice(5);
    return rawValue.startsWith(" ") ? rawValue.slice(1) : rawValue;
  }

  while (true) {
    const { done, value } = await reader.read();

    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    const chunks = buffer.split("\n\n");
    buffer = chunks.pop() ?? "";

    for (const chunk of chunks) {
      const lines = chunk.split("\n");
      const event = lines.find((line) => line.startsWith("event:"))?.slice(6).trim() ?? "message";
      const data = lines
        .filter((line) => line.startsWith("data:"))
        .map(readDataValue)
        .join("\n");

      if (event === "status" || event === "token" || event === "title" || event === "done") {
        onEvent(event, data);
      }
    }
  }

  buffer += decoder.decode();

  if (buffer.trim().length > 0) {
    const lines = buffer.split("\n");
    const event = lines.find((line) => line.startsWith("event:"))?.slice(6).trim() ?? "message";
    const data = lines
      .filter((line) => line.startsWith("data:"))
      .map(readDataValue)
      .join("\n");

    if (
      data.length > 0 &&
      (event === "status" || event === "token" || event === "title" || event === "done")
    ) {
      onEvent(event, data);
    }
  }
}

function resolveBucketId(getSettings: () => AppSettings, bucketId?: string): string {
  const settings = getSettings();
  return (
    settings.buckets.find((b) => b.id === bucketId)?.id ??
    settings.buckets.find((b) => b.id === settings.activeBucketId)?.id ??
    settings.buckets[0]?.id ??
    ""
  );
}

function getModelProvider(model: ChatStreamRequest["model"]): ChatProvider {
  return model.startsWith("gpt-") ? "openai" : "anthropic";
}

export function registerChatIpc(options: {
  getSettings: () => AppSettings;
  getWorkspaceId: () => AppWorkspaceId;
}): void {
  ipcMain.handle(ipcChannels.chatBuildContext, async (_event, input: unknown) =>
    buildChatContextPacket(
      options.getSettings,
      buildChatContextSchema.parse(input) as BuildChatContextInput
    )
  );

  ipcMain.handle(ipcChannels.chatStoreMemory, async (_event, input: unknown) => {
    const parsed = storeChatMemorySchema.parse(input) as StoreChatMemoryInput;
    const bucketId = resolveBucketId(options.getSettings, parsed.bucketId);

    if (!bucketId) {
      throw new Error("Trellis needs at least one vault before it can save memory.");
    }

    return storeTurnMemory({
      bucketId,
      messages: parsed.messages,
      references: parsed.references
    });
  });

  ipcMain.handle(ipcChannels.chatProposeNoteActions, async (_event, input: unknown) =>
    proposeChatNoteActions(
      options.getSettings,
      proposeNoteActionsSchema.parse(input) as ProposeChatNoteActionsInput
    )
  );

  ipcMain.handle(ipcChannels.chatApplyBucketOrganize, async (_event, input: unknown) => {
    const parsed = applyBucketOrganizeSchema.parse(input) as ApplyBucketOrganizeInput;
    return executeBucketOrganize(options.getSettings, parsed);
  });

  ipcMain.handle(ipcChannels.chatRunLocalReply, async (_event, input: unknown) =>
    runLocalChatReply(runLocalReplySchema.parse(input) as LocalChatRunInput)
  );

  ipcMain.handle(ipcChannels.chatStreamLocal, async (event, input: unknown) => {
    const parsed = chatStreamLocalRequestSchema.parse(input);
    await runLocalChatReplyStream(
      {
        model: parsed.model,
        messages: parsed.messages.map((message) => ({ role: message.role, content: message.content })),
        references: parsed.references
      },
      (type, payload) => {
        if (!event.sender.isDestroyed()) {
          event.sender.send(ipcChannels.chatStreamEvent, {
            requestId: parsed.requestId,
            type,
            payload
          });
        }
      }
    );
  });

  ipcMain.handle(ipcChannels.providerKeysGet, async () =>
    getProviderKeyStatusSnapshot(options.getWorkspaceId())
  );

  ipcMain.handle(ipcChannels.providerKeysSet, async (_event, input: unknown) => {
    const workspaceId = options.getWorkspaceId();
    return setProviderKey(
      workspaceId,
      providerKeyInputSchema.parse(input) as SetProviderKeyInput
    );
  });

  ipcMain.handle(ipcChannels.providerKeysDelete, async (_event, input: unknown) => {
    const workspaceId = options.getWorkspaceId();
    return deleteProviderKey(
      workspaceId,
      deleteProviderKeySchema.parse(input) as DeleteProviderKeyInput
    );
  });

  ipcMain.handle(ipcChannels.chatStream, async (event, input: unknown) => {
    const parsed = chatStreamRequestSchema.parse(input) as ChatStreamRequest;
    const provider = getModelProvider(parsed.model);
    const headers: HeadersInit = {
      "Content-Type": "application/json",
      apikey: getPublishableKey(),
      Authorization: `Bearer ${parsed.accessToken}`
    };

    if (parsed.subscriptionTier === "byok") {
      const providerApiKey = resolveProviderApiKey(
        options.getWorkspaceId(),
        provider,
        parsed.subscriptionTier
      );

      headers["x-trellis-billing-mode"] = "byok";
      headers["x-trellis-provider"] = provider;

      if (providerApiKey) {
        headers["x-trellis-provider-key"] = providerApiKey;
      }
    }

    const previewWorkspace =
      parsed.previewWorkspace === true || isAppPreviewWorkspace(options.getWorkspaceId());

    if (previewWorkspace) {
      headers["x-trellis-preview-workspace"] = "1";
    }

    const messagesForEdge = await enrichStreamMessagesForEdge(parsed.messages);

    const response = await fetch(`${getFunctionsBaseUrl()}/chat`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        sessionId: parsed.sessionId,
        model: parsed.model,
        messages: messagesForEdge,
        references: parsed.references ?? [],
        ...(previewWorkspace ? { previewWorkspace: true } : {})
      })
    });

    if (!response.ok) {
      throw await readFunctionError(response, "Chat request failed.");
    }

    await readSseStream(response, (type, payload) => {
      if (!event.sender.isDestroyed()) {
        event.sender.send(ipcChannels.chatStreamEvent, {
          requestId: parsed.requestId,
          type,
          payload
        });
      }
    });
  });
}
