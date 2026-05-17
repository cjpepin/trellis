import { randomUUID } from "node:crypto";
import type {
  AppSettings,
  ChatNoteActionProposal,
  NoteType,
  ProposeChatNoteActionsInput,
  ProposeChatNoteActionsResult
} from "../../ipc/types";
import { buildSnapshot, readNoteOrCreateIfMissing, resolveBucket } from "../../ipc/bucket";
import {
  hasDirectNoteActionIntent,
  runProposeNoteActionsCore
} from "@trellis/shared/chat/proposeNoteActionsCore";

export { hasDirectNoteActionIntent };

export async function proposeChatNoteActions(
  getSettings: () => AppSettings,
  input: ProposeChatNoteActionsInput
): Promise<ProposeChatNoteActionsResult> {
  const settings = getSettings();
  const vault = resolveBucket(settings, input.bucketId);
  const snapshot = await buildSnapshot(vault.path, vault.id, vault.name);
  const noteIndex = snapshot.notes.map((note) => ({ slug: note.slug }));

  const messages = input.messages.map((message) => ({
    id: message.id,
    role: message.role,
    content: message.content
  }));

  const core = await runProposeNoteActionsCore({
    phase: input.phase,
    messages,
    pinnedNoteSlugs: input.pinnedNoteSlugs ?? [],
    activeNoteSlug: input.activeNoteSlug ?? null,
    noteIndex,
    loadNoteBySlug: async (slug) => {
      const wiki = await readNoteOrCreateIfMissing(vault.path, slug);
      return {
        slug: wiki.slug,
        title: wiki.title,
        folderPath: wiki.folderPath,
        markdownBody: wiki.content,
        tags: wiki.tags,
        noteType: wiki.type,
        sourceCount: wiki.sources
      };
    }
  });

  const actions: ChatNoteActionProposal[] = core.actions.map((action) => ({
    id: randomUUID(),
    status: "pending",
    createdAt: Date.now(),
    kind: action.kind,
    targetTitle: action.targetTitle,
    targetSlug: action.targetSlug,
    targetFolderPath: action.targetFolderPath,
    beforeMarkdown: action.beforeMarkdown,
    afterMarkdown: action.afterMarkdown,
    frontmatter: {
      tags: action.frontmatter.tags ?? [],
      type: (action.frontmatter.type ?? "concept") as NoteType,
      sources: action.frontmatter.sources ?? 0
    },
    rationale: action.rationale,
    sourceMessageIds: action.sourceMessageIds
  }));

  return {
    actions,
    clarification: core.clarification
  };
}
