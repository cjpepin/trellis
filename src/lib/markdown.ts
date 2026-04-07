import DOMPurify from "dompurify";
import { marked } from "marked";
import { slugifyNoteTitle } from "./noteReferences";

export interface MarkdownRenderResult {
  html: string;
  links: string[];
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function renderWikiMarkdown(
  markdown: string,
  existingSlugs: Set<string>
): MarkdownRenderResult {
  const links: string[] = [];
  const preprocessed = markdown.replace(/\[\[([^\]]+)\]\]/g, (_match, rawTitle: string) => {
    const title = rawTitle.trim();
    const slug = slugifyNoteTitle(title);

    if (!slug) {
      return escapeHtml(title);
    }

    links.push(slug);
    const ghostClass = existingSlugs.has(slug)
      ? "text-trellis-accent hover:text-[var(--trellis-accent-hover)]"
      : "text-trellis-text-muted hover:text-trellis-accent";

    return `<a href="#/wiki?note=${slug}" class="${ghostClass} transition">${escapeHtml(title)}</a>`;
  });
  const html = marked.parse(preprocessed, {
    breaks: true,
    gfm: true
  }) as string;

  return {
    html: DOMPurify.sanitize(html),
    links
  };
}
