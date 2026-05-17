import { ipcMain } from "electron";
import { z } from "zod";
import type { AppSettings } from "./types";
import { chatModelIds, ipcChannels } from "./types";
import {
  appendMessages,
  createSession,
  createThought,
  deleteSession,
  getMessagesBySession,
  getStrandProvenanceForFile,
  getStrandRevisionBody,
  getThoughtById,
  listStrandRevisionsForFile,
  listSessions,
  listThoughtsForBucket,
  listWikiTouchSessionsForBucket,
  replaceMessages,
  recordWikiOps,
  getSessionNoteSlugs,
  updateSession
} from "../lib/database";
import { runThoughtEnrichment } from "../lib/thoughts/enrichThought";

const createSessionSchema = z.object({
  model: z.enum(chatModelIds),
  bucketId: z.string().min(1)
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
  noteAssetsPath: z.string().min(1).max(500).optional(),
  mimeType: z.string().min(1).max(120),
  label: z.string().min(1).max(500),
  prompt: z.string().max(4000).optional(),
  pendingGeneration: z.boolean().optional()
});

const noteTypeSchema = z.enum(["concept", "entity", "source-summary", "synthesis"]);

const chatNoteActionSchema = z.object({
  id: z.string().uuid(),
  kind: z.enum(["create_note", "update_note"]),
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

const chatReplyContextItemSchema = z.object({
  kind: z.enum(["note", "memory"]),
  title: z.string().min(1).max(500),
  slug: z.string().min(1).max(220).optional(),
  pinned: z.boolean().optional()
});

const chatReplyContextSchema = z.object({
  sourceLabels: z.array(z.string().min(1).max(80)),
  items: z.array(chatReplyContextItemSchema).max(24)
});

const composerPinSchema = z.object({
  slug: z.string().min(1).max(220),
  title: z.string().min(1).max(500)
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
    replyContext: chatReplyContextSchema.optional(),
    composerPins: z.array(composerPinSchema).max(12).optional()
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
  bucketId: z.string().min(1).optional(),
  createdAt: z.number().int().optional(),
  messageCount: z.number().int().optional()
});

const wikiOpSchema = z.object({
  sessionId: sessionIdSchema.optional(),
  file: z.string().min(1),
  action: z.enum(["create", "rewrite", "append", "merge"])
});

const bucketIdSchema = z.string().min(1);

const strandProvenanceInputSchema = z.object({
  bucketId: bucketIdSchema,
  fileName: z.string().min(1).max(500)
});

const strandRevisionListInputSchema = z.object({
  bucketId: bucketIdSchema,
  file: z.string().min(1).max(2000)
});

const strandRevisionBodyInputSchema = z.object({
  bucketId: bucketIdSchema,
  revisionId: z.string().uuid()
});

const replaceMessagesSchema = z.object({
  sessionId: sessionIdSchema,
  messages: z.array(messageSchema)
});

const createThoughtSchema = z.object({
  bucketId: z.string().min(1),
  content: z.string().min(1).max(20_000),
  sourceType: z.enum(["manual", "imported", "converted_from_note", "system"]).optional(),
  backingNoteSlug: z.string().min(1).max(220).nullable().optional()
});

export function registerDatabaseIpc(getSettings: () => AppSettings): void {
  ipcMain.handle(ipcChannels.dbListSessions, async () => listSessions());
  ipcMain.handle(ipcChannels.dbCreateSession, async (_event, payload: unknown) => {
    const parsed = createSessionSchema.parse(payload);
    return createSession(parsed.model, parsed.bucketId);
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
  ipcMain.handle(ipcChannels.dbDeleteSession, async (_event, sessionId: unknown) =>
    deleteSession(sessionIdSchema.parse(sessionId))
  );
  ipcMain.handle(ipcChannels.dbUpdateSession, async (_event, payload: unknown) =>
    updateSession(sessionUpdateSchema.parse(payload))
  );
  ipcMain.handle(ipcChannels.dbGetSessionNoteSlugs, async (_event, sessionId: unknown) =>
    getSessionNoteSlugs(sessionIdSchema.parse(sessionId))
  );
  ipcMain.handle(ipcChannels.dbRecordWikiOps, async (_event, ops: unknown) => {
    await recordWikiOps(z.array(wikiOpSchema).parse(ops));
  });
  ipcMain.handle(ipcChannels.dbListWikiTouchSessions, async (_event, bucketId: unknown) => {
    return listWikiTouchSessionsForBucket(bucketIdSchema.parse(bucketId));
  });
  ipcMain.handle(ipcChannels.dbGetStrandProvenanceForFile, async (_event, payload: unknown) => {
    const parsed = strandProvenanceInputSchema.parse(payload);
    return getStrandProvenanceForFile(parsed.bucketId, parsed.fileName);
  });
  ipcMain.handle(ipcChannels.dbListStrandRevisions, async (_event, payload: unknown) => {
    const parsed = strandRevisionListInputSchema.parse(payload);
    return listStrandRevisionsForFile(parsed.bucketId, parsed.file);
  });
  ipcMain.handle(ipcChannels.dbGetStrandRevisionBody, async (_event, payload: unknown) => {
    const parsed = strandRevisionBodyInputSchema.parse(payload);
    return getStrandRevisionBody(parsed.bucketId, parsed.revisionId);
  });
  ipcMain.handle(ipcChannels.dbCreateThought, async (_event, payload: unknown) => {
    const parsed = createThoughtSchema.parse(payload);
    const thought = await createThought(parsed);
    void runThoughtEnrichment(thought.id, getSettings);
    return thought;
  });
  ipcMain.handle(ipcChannels.dbListThoughts, async (_event, bucketId: unknown) =>
    listThoughtsForBucket(bucketIdSchema.parse(bucketId))
  );
  ipcMain.handle(ipcChannels.dbGetThought, async (_event, thoughtId: unknown) =>
    getThoughtById(sessionIdSchema.parse(thoughtId))
  );
  ipcMain.handle(ipcChannels.dbRetryThoughtEnrichment, async (_event, thoughtId: unknown) => {
    const id = sessionIdSchema.parse(thoughtId);
    void runThoughtEnrichment(id, getSettings);
  });
}
