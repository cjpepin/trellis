/** Memory title for the compact wiki catalog attached to chat context (Auto / Local). */
export const WIKI_NOTE_INDEX_MEMORY_TITLE = "Wiki note index";

export interface VaultIndexNoteRow {
  slug: string;
  title: string;
  tags: readonly string[];
  folderPath: string;
  inboundCount: number;
  excerpt: string;
}

const DEFAULT_MAX_CHARS = 10_500;

function normalizeExcerpt(excerpt: string, maxLen: number): string {
  return excerpt.replace(/\s+/g, " ").trim().slice(0, maxLen);
}

/**
 * Builds a compact, newline-delimited catalog of wiki notes for the model.
 * Lines are sorted by inbound link count (desc), then title — so highly linked
 * “hub” notes appear first when the index must be truncated.
 */
export function buildWikiNoteIndexContent(
  notes: readonly VaultIndexNoteRow[],
  options?: { maxChars?: number }
): string {
  const maxChars = options?.maxChars ?? DEFAULT_MAX_CHARS;

  if (notes.length === 0) {
    return "This wiki has no notes yet.";
  }

  const sorted = [...notes].sort((a, b) => {
    if (b.inboundCount !== a.inboundCount) {
      return b.inboundCount - a.inboundCount;
    }
    return a.title.localeCompare(b.title);
  });

  const intro =
    `Compact catalog of ${notes.length} wiki note(s). Each line: title · slug · folder · inbound links (how many other notes link here) · tags · excerpt. ` +
    `Full markdown bodies are only under "Saved notes" below for excerpts Trellis retrieved — not for every note.\n\n`;

  let remaining = maxChars - intro.length;
  const lines: string[] = [];

  for (const note of sorted) {
    const folder = note.folderPath.trim() || "(vault root)";
    const tags = note.tags.length > 0 ? note.tags.join(", ") : "—";
    const ex = normalizeExcerpt(note.excerpt, 120);
    const line = `· ${note.title} · ${note.slug} · ${folder} · in:${note.inboundCount} · ${tags} · ${ex}`;
    const cost = line.length + 1;
    if (cost > remaining) {
      break;
    }
    lines.push(line);
    remaining -= cost;
  }

  const omitted = sorted.length - lines.length;
  let body = intro + lines.join("\n");
  if (omitted > 0) {
    body += `\n\n… ${omitted} more note(s) omitted here due to size; listed lines prioritize higher inbound link counts.`;
  }

  return body;
}
