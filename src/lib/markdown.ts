import DOMPurify from "dompurify";
import { marked } from "marked";
import { notesHashHref } from "./noteRoutes";
import { slugifyNoteTitle } from "./noteReferences";

let wikiSpanColorHookInstalled = false;

function ensureWikiSpanColorSanitizeHook(): void {
  if (wikiSpanColorHookInstalled) {
    return;
  }

  wikiSpanColorHookInstalled = true;

  DOMPurify.addHook("uponSanitizeAttribute", (node, data) => {
    if (data.attrName !== "style") {
      return;
    }

    if (node.nodeName !== "SPAN") {
      data.keepAttr = false;
      return;
    }

    const value = (data.attrValue ?? "").trim().toLowerCase();

    if (!value.startsWith("color:")) {
      data.keepAttr = false;
      return;
    }

    if (value.includes("url(") || value.includes("expression")) {
      data.keepAttr = false;
    }
  });
}

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
    const linkClass = existingSlugs.has(slug)
      ? "trellis-link trellis-link-internal"
      : "trellis-link trellis-link-internal trellis-link-missing";

    return `<a href="${notesHashHref(slug)}" class="${linkClass}">${escapeHtml(title)}</a>`;
  });
  const html = marked.parse(preprocessed, {
    breaks: true,
    gfm: true
  }) as string;

  ensureWikiSpanColorSanitizeHook();

  return {
    html: DOMPurify.sanitize(html),
    links
  };
}
