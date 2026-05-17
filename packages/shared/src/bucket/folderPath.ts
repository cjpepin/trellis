/**
 * Normalizes a wiki folder path (POSIX segments under `wiki/`) for extraction JSON and IPC.
 * Empty string means the vault root (no subfolder).
 */
export function normalizeWikiFolderPath(value: string | null | undefined): string {
  if (value == null || typeof value !== "string") {
    return "";
  }

  return value
    .replace(/\\/g, "/")
    .split("/")
    .map((segment) => sanitizeWikiFolderSegment(segment))
    .filter((segment) => segment.length > 0)
    .join("/");
}

function sanitizeWikiFolderSegment(value: string): string {
  const sanitized = value
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-")
    .replace(/\s+/g, " ")
    .replace(/^\.+$/, "")
    .trim();

  return sanitized;
}
