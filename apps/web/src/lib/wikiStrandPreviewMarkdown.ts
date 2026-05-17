import matter from "gray-matter";

/**
 * Lines that only repeat frontmatter-style fields often appear at the top of strand bodies;
 * hide them in history preview so the render matches reading the note without redundant metadata.
 */
function isLeadingMetadataLine(line: string): boolean {
  const s = line.trim();
  if (!s) {
    return false;
  }
  if (/^(#{1,6})\s/.test(s)) {
    return false;
  }

  if (/^\*\*(type|sources|created|updated|tags)\*\*\s*:/i.test(s)) {
    return true;
  }
  if (/^[-*]\s+\*\*(type|sources|created|updated|tags)\*\*\s*:/i.test(s)) {
    return true;
  }
  if (/^[-*]\s+(type|sources|created|updated|tags)\s*:/i.test(s)) {
    return true;
  }
  if (/^(type|sources|created|updated|tags)\s*:/i.test(s)) {
    return true;
  }

  return false;
}

/**
 * Remove duplicate top-level title and stacked metadata lines after frontmatter is stripped.
 */
export function stripStrandPreviewNoise(
  body: string,
  options: { title?: string }
): string {
  const lines = body.replace(/\r\n/g, "\n").split("\n");
  let i = 0;

  while (i < lines.length && lines[i]?.trim() === "") {
    i += 1;
  }

  if (options.title) {
    const t = options.title.trim();
    if (t.length > 0 && i < lines.length) {
      const m = lines[i]?.match(/^#\s+(.+)$/);
      if (m && m[1]?.trim().toLowerCase() === t.toLowerCase()) {
        i += 1;
        while (i < lines.length && lines[i]?.trim() === "") {
          i += 1;
        }
      }
    }
  }

  while (i < lines.length && isLeadingMetadataLine(lines[i] ?? "")) {
    i += 1;
  }

  while (i < lines.length && lines[i]?.trim() === "") {
    i += 1;
  }

  return lines.slice(i).join("\n").trimStart();
}

/**
 * Full strand file → markdown suitable for rendered preview (no YAML; noise stripped).
 */
export function prepareStrandPreviewMarkdown(raw: string): string {
  const t = raw.trimStart();
  if (!t.startsWith("---")) {
    return stripStrandPreviewNoise(raw, {});
  }

  try {
    const parsed = matter(raw);
    const data = parsed.data as Record<string, unknown>;
    const title = typeof data.title === "string" ? data.title : undefined;
    const content = typeof parsed.content === "string" ? parsed.content : "";
    return stripStrandPreviewNoise(content.trimStart(), { title });
  } catch {
    return stripStrandPreviewNoise(raw, {});
  }
}
