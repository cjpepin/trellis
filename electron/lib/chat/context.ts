import type {
  AppSettings,
  BuildChatContextInput,
  ChatContextPacket,
  ChatContextReference,
  NoteSummary
} from "../../ipc/types";
import { buildSnapshot, resolveVault } from "../../ipc/vault";
import { searchRelevantNotes } from "../retrieval/index";
import { searchMemoryItems } from "./memory";
import { takeFirstSentence, tokenize, truncateForContext } from "./scoring";
import {
  extractWikiLinkTitles,
  normalizeTitleKey,
  slugifyExtractionTitle
} from "../../../shared/extraction/wikiLinks";

const maxContextRefs = 5;
const maxContextChars = 6_500;

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
  headingPath?: string;
  isExplicitMatch?: boolean;
}): ChatContextReference {
  return {
    type: "note",
    slug: input.slug,
    title: input.title,
    excerpt: takeFirstSentence(input.headingPath || input.content, 160),
    content: truncateForContext(input.content, 1_400),
    isExplicitMatch: input.isExplicitMatch
  };
}

function buildMemoryReference(input: {
  title: string;
  content: string;
  linkedNoteSlug: string | null;
}): ChatContextReference {
  return {
    type: "memory",
    title: input.title,
    excerpt: takeFirstSentence(input.content, 140),
    content: truncateForContext(input.content, 750),
    linkedNoteSlug: input.linkedNoteSlug
  };
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
  const preferredSlugs = [
    ...new Set([input.activeNoteSlug ?? "", ...explicitSlugs].filter(Boolean))
  ];
  const query = buildQuery(input, explicitSlugs, activeNoteTitle);
  const noteCandidates = await searchRelevantNotes({
    vaultId: vault.id,
    query,
    explicitSlugs,
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
        headingPath: candidate.headingPath,
        isExplicitMatch: candidate.isExplicitMatch
      })
    );
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

  for (const candidate of ranked) {
    if (selected.length >= maxContextRefs) {
      break;
    }

    const referenceChars =
      candidate.reference.title.length +
      candidate.reference.excerpt.length +
      candidate.reference.content.length;

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
