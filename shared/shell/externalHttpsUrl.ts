/**
 * Normalize and validate an https URL for opening in the system browser.
 * Keep in sync with `parseExternalUrl` in `electron/main.ts` (https-only).
 */
export function normalizeExternalHttpsUrl(raw: unknown): string | null {
  if (typeof raw !== "string") {
    return null;
  }

  const trimmed = raw.trim();

  if (trimmed.length === 0) {
    return null;
  }

  try {
    const parsed = new URL(trimmed);

    if (parsed.protocol !== "https:") {
      return null;
    }

    return parsed.toString();
  } catch {
    return null;
  }
}
