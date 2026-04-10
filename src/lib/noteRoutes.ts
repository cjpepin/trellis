/**
 * In-app route and hash-link helpers for the notes shell (sidebar "Notes").
 * Vault files still live under `wiki/` on disk; this module is UI/routing only.
 */
export const NOTES_ROUTE = "/notes";

const NOTES_HASH_PREFIX = `#${NOTES_ROUTE}?note=`;
/** Legacy hash links from before the Notes rebrand */
const LEGACY_WIKI_HASH_PREFIX = "#/wiki?note=";

/** React Router location, e.g. `/notes` or `/notes?note=slug` */
export function notesRoutePath(slug?: string | null): string {
  return slug ? `${NOTES_ROUTE}?note=${encodeURIComponent(slug)}` : NOTES_ROUTE;
}

/** `href` for rendered markdown / TipTap (`#/notes?note=…`) */
export function notesHashHref(slug: string): string {
  return `${NOTES_HASH_PREFIX}${encodeURIComponent(slug)}`;
}

export function isInternalNoteHashHref(href: string): boolean {
  return href.startsWith(NOTES_HASH_PREFIX) || href.startsWith(LEGACY_WIKI_HASH_PREFIX);
}

export function slugFromInternalNoteHashHref(href: string): string | null {
  if (href.startsWith(NOTES_HASH_PREFIX)) {
    return decodeURIComponent(href.slice(NOTES_HASH_PREFIX.length));
  }
  if (href.startsWith(LEGACY_WIKI_HASH_PREFIX)) {
    return decodeURIComponent(href.slice(LEGACY_WIKI_HASH_PREFIX.length));
  }
  return null;
}
