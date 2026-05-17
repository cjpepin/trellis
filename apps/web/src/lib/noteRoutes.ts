import { appShellPath } from "./appRoutes";
import { usesTrellisHashRouter } from "./platform/runtime";

/**
 * In-app route and hash-link helpers for the notes shell (sidebar "Notes").
 * Vault files still live under `wiki/` on disk; this module is UI/routing only.
 */
export const NOTES_ROUTE = "/notes";

const NOTES_HASH_PREFIX = `#${NOTES_ROUTE}?note=`;
/** Legacy hash links from before the Notes rebrand */
const LEGACY_WIKI_HASH_PREFIX = "#/wiki?note=";
const WEB_NOTES_PREFIX = `${appShellPath(NOTES_ROUTE)}?note=`;

/** React Router location, e.g. `/notes` or `/notes?note=slug` */
export function notesRoutePath(slug?: string | null): string {
  const basePath = appShellPath(NOTES_ROUTE);
  return slug ? `${basePath}?note=${encodeURIComponent(slug)}` : basePath;
}

/** `href` for rendered markdown / TipTap (`#/notes?note=…` on shell builds, `/app/notes?...` on web). */
export function notesHashHref(slug: string): string {
  if (!usesTrellisHashRouter()) {
    return `${appShellPath(NOTES_ROUTE)}?note=${encodeURIComponent(slug)}`;
  }

  return `${NOTES_HASH_PREFIX}${encodeURIComponent(slug)}`;
}

export function isInternalNoteHashHref(href: string): boolean {
  return (
    href.startsWith(NOTES_HASH_PREFIX) ||
    href.startsWith(LEGACY_WIKI_HASH_PREFIX) ||
    href.startsWith(WEB_NOTES_PREFIX) ||
    href.startsWith(`${NOTES_ROUTE}?note=`)
  );
}

export function slugFromInternalNoteHashHref(href: string): string | null {
  if (href.startsWith(NOTES_HASH_PREFIX)) {
    return decodeURIComponent(href.slice(NOTES_HASH_PREFIX.length));
  }
  if (href.startsWith(LEGACY_WIKI_HASH_PREFIX)) {
    return decodeURIComponent(href.slice(LEGACY_WIKI_HASH_PREFIX.length));
  }
  if (href.startsWith(WEB_NOTES_PREFIX)) {
    return decodeURIComponent(href.slice(WEB_NOTES_PREFIX.length));
  }
  if (href.startsWith(`${NOTES_ROUTE}?note=`)) {
    return decodeURIComponent(href.slice(`${NOTES_ROUTE}?note=`.length));
  }
  return null;
}
