/**
 * Shared heuristics for “save draft to Strand” note-action proposals (desktop vault + cloud).
 */
import { stripAssistantDraftMarkdown } from "./assistantDraftCleanup.ts";

export interface ProposalMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
}

export interface NoteTargetForProposal {
  slug: string;
  title: string;
  folderPath: string;
  markdownBody: string;
  tags: string[];
  noteType: string;
  sourceCount: number;
}

export interface NoteActionProposalPayload {
  kind: "create_note" | "update_note";
  targetTitle: string;
  targetSlug: string;
  targetFolderPath: string;
  beforeMarkdown: string;
  afterMarkdown: string;
  frontmatter: {
    tags?: string[];
    type?: string;
    sources?: number;
  };
  rationale: string;
  sourceMessageIds: string[];
}

function normalizeFolderPath(folderPath: string): string {
  return folderPath
    .replace(/\\/g, "/")
    .split("/")
    .map((part) => part.trim())
    .filter((part) => part.length > 0 && part !== "." && part !== "..")
    .join("/");
}

export function hasDirectNoteActionIntent(content: string): boolean {
  const text = content.trim();

  if (!text) {
    return false;
  }

  if (/\b(?:save|store|persist|write)\b/i.test(text)) {
    return /\b(?:note|it|this|that|vault|wiki)\b/i.test(text);
  }

  if (/\b(?:update|append|add)\b/i.test(text)) {
    return /\[\[[^\]]+\]\]/.test(text) || /\b(?:note|wiki|vault)\b/i.test(text);
  }

  return /\bcreate\s+(?:a\s+|an\s+|new\s+)?note\b/i.test(text);
}

function isShortSaveAffirmation(content: string): boolean {
  const text = content.trim();
  if (text.length === 0 || text.length > 200 || text.includes("\n")) {
    return false;
  }

  const core = text.replace(/[.!…\s]+$/u, "").trim();
  if (core.length === 0) {
    return false;
  }

  return /^(?:yes|yeah|yep|sure|ok|okay|please do|go ahead|save it|do it|proceed|sounds good|that works|please save|save please)$/i.test(
    core
  );
}

function mergeWikiDraftIntoNote(before: string, cleanedDraft: string): string {
  const draft = cleanedDraft.trim();
  if (draft.length === 0) {
    return before;
  }
  if (before.trim().length === 0) {
    return draft;
  }
  return `${before.trimEnd()}\n\n${draft}`;
}

function buildAction(input: {
  kind: "create_note" | "update_note";
  targetTitle: string;
  targetSlug: string;
  targetFolderPath: string;
  beforeMarkdown: string;
  afterMarkdown: string;
  frontmatter: NoteActionProposalPayload["frontmatter"];
  rationale: string;
  sourceMessageIds: string[];
}): NoteActionProposalPayload {
  return {
    kind: input.kind,
    targetTitle: input.targetTitle,
    targetSlug: input.targetSlug,
    targetFolderPath: input.targetFolderPath,
    beforeMarkdown: input.beforeMarkdown,
    afterMarkdown: input.afterMarkdown,
    frontmatter: input.frontmatter,
    rationale: input.rationale,
    sourceMessageIds: input.sourceMessageIds
  };
}

async function proposePinnedWikiNoteUpdate(input: {
  latestUser: ProposalMessage;
  draftAssistant: ProposalMessage;
  notes: Array<{ slug: string }>;
  pinnedSlugs: string[];
  activeNoteSlug: string | null;
  loadNoteBySlug: (slug: string) => Promise<NoteTargetForProposal | null>;
}): Promise<NoteActionProposalPayload | null> {
  const cleanedDraft = stripAssistantDraftMarkdown(input.draftAssistant.content).trim();

  if (cleanedDraft.length < 24) {
    return null;
  }

  let targetSlug: string | undefined;

  if (input.pinnedSlugs.length > 0) {
    targetSlug = input.pinnedSlugs[0];
  } else if (input.activeNoteSlug?.trim()) {
    if (!/\b(?:this|the)\s+(?:active\s+)?note\b/i.test(input.latestUser.content)) {
      return null;
    }
    targetSlug = input.activeNoteSlug.trim();
  }

  if (!targetSlug) {
    return null;
  }

  const summary = input.notes.find((note) => note.slug === targetSlug);
  if (!summary) {
    return null;
  }

  const wiki = await input.loadNoteBySlug(targetSlug);
  if (!wiki) {
    return null;
  }

  const beforeMarkdown = wiki.markdownBody;
  const afterMarkdown = mergeWikiDraftIntoNote(beforeMarkdown, cleanedDraft);

  if (afterMarkdown.trim() === beforeMarkdown.trim()) {
    return null;
  }

  return buildAction({
    kind: "update_note",
    targetTitle: wiki.title,
    targetSlug: wiki.slug,
    targetFolderPath: normalizeFolderPath(wiki.folderPath),
    beforeMarkdown,
    afterMarkdown,
    frontmatter: {
      tags: wiki.tags,
      type: wiki.noteType,
      sources: wiki.sourceCount
    },
    rationale: `Merge the assistant draft from chat into [[${wiki.title}]].`,
    sourceMessageIds: [input.draftAssistant.id, input.latestUser.id]
  });
}

function getLatestUserAndDraftAssistant(messages: ProposalMessage[]): {
  latestUser: ProposalMessage | null;
  draftAssistant: ProposalMessage | null;
} {
  let latestUserIndex = -1;

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === "user") {
      latestUserIndex = index;
      break;
    }
  }

  if (latestUserIndex === -1) {
    return {
      latestUser: null,
      draftAssistant: null
    };
  }

  const latestUser = messages[latestUserIndex] ?? null;
  const immediatePrior = messages[latestUserIndex - 1];

  if (immediatePrior?.role !== "assistant") {
    return {
      latestUser,
      draftAssistant: null
    };
  }

  let hasUserBeforeImmediateAssistant = false;

  for (let index = latestUserIndex - 2; index >= 0; index -= 1) {
    if (messages[index]?.role === "user") {
      hasUserBeforeImmediateAssistant = true;
      break;
    }
  }

  if (!hasUserBeforeImmediateAssistant) {
    return {
      latestUser,
      draftAssistant: null
    };
  }

  return {
    latestUser,
    draftAssistant: immediatePrior
  };
}

function getLatestUserAndDraftAssistantFromPostResponse(messages: ProposalMessage[]): {
  latestUser: ProposalMessage | null;
  draftAssistant: ProposalMessage | null;
} {
  let latestAssistantIndex = -1;

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === "assistant") {
      latestAssistantIndex = index;
      break;
    }
  }

  if (latestAssistantIndex === -1) {
    return {
      latestUser: null,
      draftAssistant: null
    };
  }

  const draftAssistant = messages[latestAssistantIndex] ?? null;

  for (let index = latestAssistantIndex - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role === "assistant") {
      return {
        latestUser: null,
        draftAssistant
      };
    }
    if (message?.role === "user") {
      return {
        latestUser: message,
        draftAssistant
      };
    }
  }

  return {
    latestUser: null,
    draftAssistant
  };
}

export interface RunProposeNoteActionsCoreInput {
  phase?: "pre_response" | "post_response";
  messages: ProposalMessage[];
  pinnedNoteSlugs: string[];
  activeNoteSlug: string | null;
  noteIndex: Array<{ slug: string }>;
  loadNoteBySlug: (slug: string) => Promise<NoteTargetForProposal | null>;
}

export async function runProposeNoteActionsCore(
  input: RunProposeNoteActionsCoreInput
): Promise<{ actions: NoteActionProposalPayload[]; clarification: null }> {
  const phase = input.phase ?? "pre_response";
  const pinnedSlugs = (input.pinnedNoteSlugs ?? []).filter((slug) => slug.trim().length > 0);
  const { latestUser, draftAssistant } =
    phase === "post_response"
      ? getLatestUserAndDraftAssistantFromPostResponse(input.messages)
      : getLatestUserAndDraftAssistant(input.messages);

  if (!latestUser || !draftAssistant) {
    return {
      actions: [],
      clarification: null
    };
  }

  const wikiIntent =
    hasDirectNoteActionIntent(latestUser.content) || isShortSaveAffirmation(latestUser.content);

  const wantsThisActiveNote =
    pinnedSlugs.length === 0 &&
    Boolean(input.activeNoteSlug?.trim()) &&
    /\b(?:this|the)\s+(?:active\s+)?note\b/i.test(latestUser.content);

  const couldWiki = wikiIntent && (pinnedSlugs.length > 0 || wantsThisActiveNote);

  if (!couldWiki) {
    return {
      actions: [],
      clarification: null
    };
  }

  const wikiSave = await proposePinnedWikiNoteUpdate({
    latestUser,
    draftAssistant,
    notes: input.noteIndex,
    pinnedSlugs,
    activeNoteSlug: input.activeNoteSlug ?? null,
    loadNoteBySlug: input.loadNoteBySlug
  });

  if (wikiSave) {
    return {
      actions: [wikiSave],
      clarification: null
    };
  }

  return {
    actions: [],
    clarification: null
  };
}
