import type {
  ChatContextPacket,
  ChatContextReference,
  ChatReplyContext,
  ChatReplyContextItem
} from "@electron/ipc/types";
import { WIKI_NOTE_INDEX_MEMORY_TITLE } from "./vaultIndex";

const memoryItemTitleMaxChars = 220;

/**
 * Memory references use stable kind labels as {@link ChatContextReference.title} ("Fact", "Open Loop", …).
 * Several items of the same kind look identical in the UI; the excerpt is the first line of stored content and
 * differentiates entries.
 */
function memoryItemDisplayTitle(reference: ChatContextReference): string {
  const snippet = reference.excerpt.trim();

  if (snippet.length === 0) {
    return reference.title;
  }

  if (snippet.length <= memoryItemTitleMaxChars) {
    return snippet;
  }

  return `${snippet.slice(0, memoryItemTitleMaxChars - 1)}…`;
}

function referenceToItem(
  reference: ChatContextReference,
  pinnedSlugs: Set<string>
): ChatReplyContextItem {
  if (reference.type === "note") {
    return {
      kind: "note",
      title: reference.title,
      ...(reference.slug ? { slug: reference.slug } : {}),
      ...(reference.slug && pinnedSlugs.has(reference.slug) ? { pinned: true } : {})
    };
  }

  return {
    kind: "memory",
    title: memoryItemDisplayTitle(reference)
  };
}

/**
 * Notes that were only pulled in by on-device retrieval can crowd out what mattered for the answer.
 * Keep notes the user aimed at the model (wiki link / pin / active strand) plus anything marked explicit.
 */
function isGroundedNoteReference(
  reference: ChatContextReference,
  pinned: Set<string>,
  activeNoteSlug: string | null
): boolean {
  if (reference.type !== "note") {
    return true;
  }

  const slug = reference.slug;

  if (!slug) {
    return true;
  }

  if (reference.isExplicitMatch) {
    return true;
  }

  if (pinned.has(slug)) {
    return true;
  }

  if (activeNoteSlug && slug === activeNoteSlug) {
    return true;
  }

  return false;
}

function shouldShowReference(
  reference: ChatContextReference,
  pinned: Set<string>,
  activeNoteSlug: string | null
): boolean {
  if (reference.type === "memory" && reference.title === WIKI_NOTE_INDEX_MEMORY_TITLE) {
    return false;
  }

  if (reference.type === "note") {
    return isGroundedNoteReference(reference, pinned, activeNoteSlug);
  }

  return true;
}

function replySourceLabelsFor(references: ChatContextReference[]): string[] {
  const hasNotes = references.some((reference) => reference.type === "note");
  const hasPrivateMemory = references.some(
    (reference) =>
      reference.type === "memory" && reference.title !== WIKI_NOTE_INDEX_MEMORY_TITLE
  );

  return [hasNotes ? "Saved notes" : null, hasPrivateMemory ? "Private memory" : null].filter(
    (value): value is string => Boolean(value)
  );
}

export interface BuildChatReplyContextOptions {
  /** Strand that was open in Wiki while sending; matches context building when not omitted for first turn. */
  activeNoteSlug?: string | null;
}

/** Build a compact, UI-safe summary of which strands and memory actually grounded this reply. */
export function buildChatReplyContext(
  packet: ChatContextPacket,
  pinnedNoteSlugs: string[],
  options?: BuildChatReplyContextOptions
): ChatReplyContext | undefined {
  if (packet.references.length === 0) {
    return undefined;
  }

  const pinned = new Set(pinnedNoteSlugs.filter(Boolean));
  const activeNoteSlug = options?.activeNoteSlug ?? null;

  const filtered = packet.references.filter((reference) =>
    shouldShowReference(reference, pinned, activeNoteSlug)
  );

  if (filtered.length === 0) {
    return undefined;
  }

  const items = filtered.map((reference) => referenceToItem(reference, pinned));
  const sourceLabels = replySourceLabelsFor(filtered);

  return {
    sourceLabels,
    items
  };
}
