/** In-memory chat image cache for the browser (no `window.trellis.media` disk cache). */

const entries = new Map<string, { base64: string; mimeType: string }>();

export function writeWebMediaCache(base64: string, mimeType: string): string {
  const id = crypto.randomUUID();
  entries.set(id, { base64, mimeType });
  return id;
}

export function getWebMediaDataUrl(fileId: string): string | null {
  const row = entries.get(fileId);
  if (!row) {
    return null;
  }
  return `data:${row.mimeType};base64,${row.base64}`;
}
