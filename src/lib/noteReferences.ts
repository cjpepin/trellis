import type { NoteSummary } from "@electron/ipc/types";

export interface SlashCommandMatch {
  from: number;
  to: number;
  query: string;
}

const wikiLinkPattern = /\[\[([^[\]]+)\]\]/g;
const slashCommandPattern = /(?:^|\s)\/([^\s[\]]*)$/;

export function slugifyNoteTitle(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function extractWikiLinkTitles(value: string): string[] {
  const matches = value.matchAll(wikiLinkPattern);

  return [...new Set([...matches].map((match) => match[1]?.trim()).filter(Boolean) as string[])];
}

export function resolveReferencedNoteSlug(
  rawTitle: string,
  notes: NoteSummary[]
): string | null {
  const normalizedTitle = rawTitle.trim().toLowerCase();
  const exactTitleMatch = notes.find((note) => note.title.trim().toLowerCase() === normalizedTitle);

  if (exactTitleMatch) {
    return exactTitleMatch.slug;
  }

  const normalizedSlug = slugifyNoteTitle(rawTitle);
  const slugMatch = notes.find((note) => note.slug === normalizedSlug);

  return slugMatch?.slug ?? null;
}

export function getSlashCommandMatch(value: string, cursor: number): SlashCommandMatch | null {
  const prefix = value.slice(0, cursor);
  const match = prefix.match(slashCommandPattern);

  if (!match) {
    return null;
  }

  const rawMatch = match[0];
  const slashOffset = rawMatch.lastIndexOf("/");

  if (slashOffset === -1) {
    return null;
  }

  return {
    from: prefix.length - (rawMatch.length - slashOffset),
    to: cursor,
    query: match[1] ?? ""
  };
}

export function insertNoteReference(
  value: string,
  match: SlashCommandMatch,
  noteTitle: string
): {
  nextValue: string;
  nextCursor: number;
} {
  const insertedReference = `[[${noteTitle}]] `;
  const nextValue = `${value.slice(0, match.from)}${insertedReference}${value.slice(match.to)}`;
  const nextCursor = match.from + insertedReference.length;

  return {
    nextValue,
    nextCursor
  };
}
