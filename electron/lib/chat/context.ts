import type {
  AppSettings,
  BuildChatContextInput,
  ChatContextPacket,
  ChatContextReference,
  NoteSummary
} from "../../ipc/types";
import { buildSnapshot, resolveVault } from "../../ipc/vault";
import { listRecentSessionNoteLinks } from "../database";
import { searchRelevantNotes } from "../retrieval/index";
import { searchMemoryItems } from "./memory";
import { takeFirstSentence, tokenize, truncateForContext } from "./scoring";
import {
  extractWikiLinkTitles,
  normalizeTitleKey,
  slugifyExtractionTitle
} from "../../../shared/extraction/wikiLinks";
import { hasVaultOrganizeIntent } from "./vaultOrganize";

const maxContextRefs = 5;
const maxContextChars = 6_500;

function asksForRecentChats(messages: Array<{ content: string }>): boolean {
  const latestUser = [...messages].reverse().find((message) => message.content.trim().length > 0);
  const content = latestUser?.content ?? "";

  const mentionsChatHistory =
    /\b(?:past|recent|last|previous)\s+\d*\s*(?:chats?|conversations?|sessions?)\b/i.test(content) ||
    /\b\d+\s+(?:most\s+recent\s+)?(?:chats?|conversations?|sessions?)\b/i.test(content) ||
    (/\b(?:summarize|summary)\b/i.test(content) && /\b(?:chats?|conversations?|sessions?)\b/i.test(content));

  const asksForChatLinks =
    /\b(?:chats?|conversations?|sessions?)\b/i.test(content) &&
    /\b(?:link|links|notes?|wiki)\b/i.test(content);

  return mentionsChatHistory || asksForChatLinks;
}

function resolveExplicitSlugs(messages: Array<{ content: string }>, notes: NoteSummary[]): string[] {
  const byTitle = new Map(notes.map((note) => [normalizeTitleKey(note.title), note.slug]));
  const bySlug = new Map(notes.map((note) => [note.slug, note.slug]));

  return [...new Set(
    messages.flatMap((message) =>
      extractWikiLinkTitles(message.content)
        .map((title) => byTitle.get(normalizeTitleKey(title)) ?? bySlug.get(slugifyExtractionTitle(title)))
        .filter((slug): slug is string => Boolean(slug))
    )
  )];
}

function buildQuery(
  input: BuildChatContextInput,
  explicitSlugs: string[],
  activeNoteTitle?: string | null
): string {
  const messageCorpus = input.messages.slice(-4).map((message) => message.content).join("\n\n");
  const explicitCorpus = explicitSlugs.join(" ");

  return [input.sessionTitle ?? "", activeNoteTitle ?? "", explicitCorpus, messageCorpus]
    .filter((part) => part.trim().length > 0)
    .join("\n\n");
}

function noteAllowedForMode(referenceTags: string[], mode: BuildChatContextInput["mode"]): boolean {
  if (mode === "local") {
    return true;
  }

  return !referenceTags.some((tag) => tag.trim().toLowerCase() === "local-only");
}

function buildNoteReference(input: {
  slug: string;
  title: string;
  content: string;
  tags: string[];
  headingPath?: string;
  isExplicitMatch?: boolean;
}): ChatContextReference {
  return {
    type: "note",
    slug: input.slug,
    title: input.title,
    excerpt: takeFirstSentence(input.headingPath || input.content, 160),
    content: truncateForContext(input.content, 1_400),
    tags: input.tags,
    isExplicitMatch: input.isExplicitMatch
  };
}

function buildMemoryReference(input: {
  title: string;
  content: string;
  linkedNoteSlug: string | null;
  /** Defaults to 750; recent-session summaries need more room for [[links]]. */
  contentMaxChars?: number;
}): ChatContextReference {
  const contentMaxChars = input.contentMaxChars ?? 750;
  return {
    type: "memory",
    title: input.title,
    excerpt: takeFirstSentence(input.content, 140),
    content: truncateForContext(input.content, contentMaxChars),
    linkedNoteSlug: input.linkedNoteSlug
  };
}

const recentChatsMemoryTitle = "Recent Chats";
const vaultOrganizeMemoryTitle = "Trellis wiki actions";

function buildVaultOrganizeContextHint(
  messages: BuildChatContextInput["messages"]
): ChatContextReference | null {
  const latestUser = [...messages].reverse().find((message) => message.role === "user");

  if (!latestUser || !hasVaultOrganizeIntent(latestUser.content)) {
    return null;
  }

  return buildMemoryReference({
    title: vaultOrganizeMemoryTitle,
    content: [
      "The user asked to create wiki folders and/or move notes within Trellis (not a generic external app).",
      "Trellis can create folders and move notes in the local vault when they ask from chat; your answer must match that capability.",
      "Do not refuse, do not say you cannot create folders or move files, and do not redirect them to another note app or a generic preferred system.",
      "Respond helpfully: confirm what they want organized, mention they can verify in Wiki, and stay consistent with Trellis, not a plain web chatbot."
    ].join("\n"),
    linkedNoteSlug: null
  });
}

function referenceWeight(reference: ChatContextReference): number {
  if (reference.type === "note" && reference.isExplicitMatch) {
    return 100;
  }

  if (reference.type === "note" && reference.slug) {
    return 40;
  }

  return 20;
}

function referenceCharBudget(reference: ChatContextReference): number {
  return (
    reference.title.length + reference.excerpt.length + reference.content.length
  );
}

export async function buildChatContextPacket(
  getSettings: () => AppSettings,
  input: BuildChatContextInput
): Promise<ChatContextPacket> {
  if (input.mode === "off") {
    return {
      mode: input.mode,
      references: [],
      sourceLabels: []
    };
  }

  const settings = getSettings();
  const vault = resolveVault(settings, input.vaultId);
  const snapshot = await buildSnapshot(vault.path, vault.id, vault.name);
  const noteTagsBySlug = new Map(snapshot.notes.map((note) => [note.slug, note.tags]));
  const activeNoteTitle =
    input.activeNoteSlug
      ? snapshot.notes.find((note) => note.slug === input.activeNoteSlug)?.title ?? null
      : null;
  const explicitSlugs = resolveExplicitSlugs(input.messages, snapshot.notes);
  const recentSessionLinks = asksForRecentChats(input.messages)
    ? await listRecentSessionNoteLinks(3, input.currentSessionId ?? null)
    : [];
  const recentSessionSlugs = recentSessionLinks.flatMap((session) =>
    session.noteFiles
      .map((file) => file.replace(/\.md$/i, ""))
      .filter((slug) => snapshot.notes.some((note) => note.slug === slug))
  );
  const preferredSlugs = [
    ...new Set([input.activeNoteSlug ?? "", ...explicitSlugs, ...recentSessionSlugs].filter(Boolean))
  ];
  const query = buildQuery(input, explicitSlugs, activeNoteTitle);
  const noteCandidates = await searchRelevantNotes({
    vaultId: vault.id,
    query,
    explicitSlugs: [...new Set([...explicitSlugs, ...recentSessionSlugs])],
    limit: 6
  });
  const memoryCandidates = await searchMemoryItems({
    vaultId: vault.id,
    query,
    preferredNoteSlugs: preferredSlugs,
    limit: 4
  });

  const references: ChatContextReference[] = [];

  for (const candidate of noteCandidates) {
    if (!noteAllowedForMode(candidate.tags, input.mode)) {
      continue;
    }

    references.push(
      buildNoteReference({
        slug: candidate.slug,
        title: candidate.title,
        content: candidate.content,
        tags: candidate.tags,
        headingPath: candidate.headingPath,
        isExplicitMatch: candidate.isExplicitMatch
      })
    );
  }

  let recentChatsReference: ChatContextReference | null = null;

  if (recentSessionLinks.length > 0) {
    const titleBySlug = new Map(snapshot.notes.map((note) => [note.slug, note.title]));
    const recentSummary = recentSessionLinks
      .map((session) => {
        const bracketLinks = session.noteFiles
          .map((file) => titleBySlug.get(file.replace(/\.md$/i, "")))
          .filter((title): title is string => Boolean(title))
          .map((title) => `[[${title}]]`);

        const linkPart =
          bracketLinks.length > 0
            ? `: notes touched in that chat — ${bracketLinks.join(", ")}`
            : ": (no wiki writes recorded for this chat yet; extraction or approved note saves add links here)";

        return `- **${session.title}**${linkPart}`;
      })
      .join("\n");

    recentChatsReference = buildMemoryReference({
      title: recentChatsMemoryTitle,
      content: [
        "Recent chat sessions (most recently updated first, excluding this conversation).",
        "Cite notes using the exact [[Note Title]] links below when you summarize.",
        "",
        recentSummary
      ].join("\n"),
      linkedNoteSlug: null,
      contentMaxChars: 3_200
    });
  }

  for (const candidate of memoryCandidates) {
    if (
      input.mode !== "local" &&
      candidate.linkedNoteSlug &&
      !noteAllowedForMode(noteTagsBySlug.get(candidate.linkedNoteSlug) ?? [], input.mode)
    ) {
      continue;
    }

    references.push(
      buildMemoryReference({
        title: candidate.kind.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase()),
        content: candidate.content,
        linkedNoteSlug: candidate.linkedNoteSlug
      })
    );
  }

  const ranked = references
    .map((reference) => ({
      reference,
      score:
        referenceWeight(reference) +
        (reference.type === "note" && reference.slug && preferredSlugs.includes(reference.slug) ? 30 : 0) +
        (reference.type === "memory" && reference.linkedNoteSlug && preferredSlugs.includes(reference.linkedNoteSlug)
          ? 18
          : 0)
    }))
    .sort((left, right) => right.score - left.score);

  const selected: ChatContextReference[] = [];
  let charCount = 0;

  if (recentChatsReference) {
    selected.push(recentChatsReference);
    charCount += referenceCharBudget(recentChatsReference);
  }

  const vaultOrganizeHint = buildVaultOrganizeContextHint(input.messages);

  if (vaultOrganizeHint) {
    selected.push(vaultOrganizeHint);
    charCount += referenceCharBudget(vaultOrganizeHint);
  }

  for (const candidate of ranked) {
    if (selected.length >= maxContextRefs) {
      break;
    }

    const referenceChars = referenceCharBudget(candidate.reference);

    if (selected.length > 0 && charCount + referenceChars > maxContextChars) {
      continue;
    }

    if (
      candidate.reference.type === "note" &&
      selected.some(
        (reference) =>
          reference.type === "note" &&
          reference.slug &&
          reference.slug === candidate.reference.slug
      )
    ) {
      continue;
    }

    if (
      candidate.reference.type === "memory" &&
      selected.some(
        (reference) =>
          reference.type === "memory" &&
          tokenize(reference.content).join(" ") === tokenize(candidate.reference.content).join(" ")
      )
    ) {
      continue;
    }

    selected.push(candidate.reference);
    charCount += referenceChars;
  }

  const sourceLabels = [
    selected.some((reference) => reference.type === "note") ? "Saved notes" : null,
    selected.some((reference) => reference.type === "memory") ? "Private memory" : null
  ].filter((value): value is string => Boolean(value));

  return {
    mode: input.mode,
    references: selected,
    sourceLabels
  };
}
