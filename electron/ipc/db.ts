import { ipcMain } from "electron";
import { z } from "zod";
import { chatModelIds, ipcChannels } from "./types";
import {
  appendMessages,
  createSession,
  getMessagesBySession,
  listSessions,
  replaceMessages,
  recordWikiOps,
  updateSession
} from "../lib/database";

const createSessionSchema = z.object({
  model: z.enum(chatModelIds),
  vaultId: z.string().min(1)
});

const sessionIdSchema = z.string().uuid();

const chatAttachmentSchema = z.object({
  kind: z.enum(["file", "url"]),
  label: z.string().min(1).max(500),
  text: z.string().min(1).max(500_000),
  sourceUrl: z.string().url().optional()
});

const chatMediaArtifactSchema = z.object({
  kind: z.enum(["image", "generated_image"]),
  fileId: z.string().uuid(),
  mimeType: z.string().min(1).max(120),
  label: z.string().min(1).max(500),
  prompt: z.string().max(4000).optional(),
  pendingGeneration: z.boolean().optional()
});

const noteTypeSchema = z.enum(["concept", "entity", "source-summary", "synthesis"]);

const chatNoteActionSchema = z.object({
  id: z.string().uuid(),
  kind: z.enum(["create_note", "update_note", "create_template", "update_template"]),
  status: z.enum(["pending", "approved", "rejected", "failed"]),
  targetTitle: z.string().min(1).max(120),
  targetSlug: z.string().min(1).max(180),
  targetFolderPath: z.string().max(500),
  beforeMarkdown: z.string().max(500_000),
  afterMarkdown: z.string().min(1).max(500_000),
  frontmatter: z
    .object({
      title: z.string().optional(),
      created: z.string().optional(),
      updated: z.string().optional(),
      sources: z.number().int().optional(),
      tags: z.array(z.string()).optional(),
      type: noteTypeSchema.optional(),
      url: z.string().url().optional()
    }),
  rationale: z.string().min(1).max(2000),
  sourceMessageIds: z.array(z.string().uuid()).min(1).max(12),
  createdAt: z.number().int(),
  appliedAt: z.number().int().optional(),
  errorMessage: z.string().max(2000).optional()
});

const chatTemplateInstanceSchema = z.object({
  templateSlug: z.string().min(1).max(180),
  templateTitle: z.string().min(1).max(180),
  instanceSlug: z.string().min(1).max(220),
  instanceTitle: z.string().min(1).max(180),
  status: z.enum(["active", "completed", "failed"]),
  sourceUserMessageIds: z.array(z.string().uuid()).min(1).max(80),
  answerUserMessageIds: z.array(z.string().uuid()).max(80),
  createdAt: z.number().int(),
  updatedAt: z.number().int(),
  completedAt: z.number().int().optional(),
  errorMessage: z.string().max(2000).optional()
});

const messageSchema = z
  .object({
    id: z.string().uuid(),
    sessionId: sessionIdSchema,
    role: z.enum(["user", "assistant"]),
    content: z.string().max(200_000),
    createdAt: z.number().int(),
    tokens: z.number().int().nullable(),
    attachments: z.array(chatAttachmentSchema).max(12).optional(),
    mediaArtifacts: z.array(chatMediaArtifactSchema).max(8).optional(),
    noteActions: z.array(chatNoteActionSchema).max(6).optional(),
    templateInstance: chatTemplateInstanceSchema.optional()
  })
  .superRefine((value, ctx) => {
    const hasText = value.content.trim().length > 0;
    const hasAttachments = (value.attachments?.length ?? 0) > 0;
    const hasMedia = (value.mediaArtifacts?.length ?? 0) > 0;
    const hasNoteActions = (value.noteActions?.length ?? 0) > 0;

    if (!hasText && !hasAttachments && !hasMedia && !hasNoteActions) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Message needs non-empty content, an attachment, a media item, or a note action."
      });
    }
  });

const sessionUpdateSchema = z.object({
  id: sessionIdSchema,
  title: z.string().min(1).max(80).optional(),
  updatedAt: z.number().int().optional(),
  model: z.enum(chatModelIds).optional(),
  vaultId: z.string().min(1).optional(),
  createdAt: z.number().int().optional(),
  messageCount: z.number().int().optional()
});

const wikiOpSchema = z.object({
  sessionId: sessionIdSchema.optional(),
  file: z.string().min(1),
  action: z.enum(["create", "rewrite", "append"])
});

const replaceMessagesSchema = z.object({
  sessionId: sessionIdSchema,
  messages: z.array(messageSchema)
});

export function registerDatabaseIpc(): void {
  ipcMain.handle(ipcChannels.dbListSessions, async () => listSessions());
  ipcMain.handle(ipcChannels.dbCreateSession, async (_event, payload: unknown) => {
    const parsed = createSessionSchema.parse(payload);
    return createSession(parsed.model, parsed.vaultId);
  });
  ipcMain.handle(ipcChannels.dbGetMessages, async (_event, sessionId: string) =>
    getMessagesBySession(sessionIdSchema.parse(sessionId))
  );
  ipcMain.handle(ipcChannels.dbAppendMessages, async (_event, messages: unknown) => {
    await appendMessages(z.array(messageSchema).parse(messages));
  });
  ipcMain.handle(ipcChannels.dbReplaceMessages, async (_event, payload: unknown) => {
    const parsed = replaceMessagesSchema.parse(payload);
    await replaceMessages(parsed.sessionId, parsed.messages);
  });
  ipcMain.handle(ipcChannels.dbUpdateSession, async (_event, payload: unknown) =>
    updateSession(sessionUpdateSchema.parse(payload))
  );
  ipcMain.handle(ipcChannels.dbRecordWikiOps, async (_event, ops: unknown) => {
    await recordWikiOps(z.array(wikiOpSchema).parse(ops));
  });
}
