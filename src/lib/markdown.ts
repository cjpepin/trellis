import DOMPurify from "dompurify";
import { marked } from "marked";
import { notesHashHref } from "./noteRoutes";
import { slugifyNoteTitle } from "./noteReferences";

let wikiSpanStyleHookInstalled = false;

function ensureWikiSpanStyleSanitizeHook(): void {
  if (wikiSpanStyleHookInstalled) {
    return;
  }

  wikiSpanStyleHookInstalled = true;

  DOMPurify.addHook("uponSanitizeAttribute", (node, data) => {
    if (data.attrName !== "style") {
      return;
    }

    const raw = (data.attrValue ?? "").trim().toLowerCase();
    if (!raw) {
      data.keepAttr = false;
      return;
    }

    const parts = raw
      .split(";")
      .map((part) => part.trim())
      .filter((part) => part.length > 0);
    const nodeName = node.nodeName;

    if (["TABLE", "COL", "TH", "TD"].includes(nodeName)) {
      let allowedTableSize = false;

      for (const part of parts) {
        const [rawKey, ...rawValueParts] = part.split(":");
        const key = rawKey?.trim();
        const value = rawValueParts.join(":").trim().replace(/\s+/g, "");

        if ((key === "width" || key === "min-width") && /^[\d.]+(px|rem|em|%)$/.test(value)) {
          allowedTableSize = true;
          continue;
        }

        data.keepAttr = false;
        return;
      }

      data.keepAttr = allowedTableSize;
      return;
    }

    if (nodeName !== "SPAN") {
      data.keepAttr = false;
      return;
    }

    let allowedColor = false;
    let allowedSize = false;

    for (const part of parts) {
      if (part.startsWith("color:")) {
        const value = part.slice("color:".length).trim();
        if (value.includes("url(") || value.includes("expression")) {
          data.keepAttr = false;
          return;
        }
        allowedColor = true;
        continue;
      }

      if (part.startsWith("font-size:")) {
        const value = part.slice("font-size:".length).trim().replace(/\s+/g, "");
        if (!/^[\d.]+(rem|em|%)$/.test(value)) {
          data.keepAttr = false;
          return;
        }
        allowedSize = true;
        continue;
      }

      data.keepAttr = false;
      return;
    }

    if (!allowedColor && !allowedSize) {
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

function externalLinkPreviewHtml(url: string, label: string): string {
  let domain = url;

  try {
    domain = new URL(url).hostname.replace(/^www\./, "");
  } catch {
    domain = url;
  }

  return [
    `<div class="trellis-link-preview" data-trellis-link-preview="true" data-preview-url="${escapeHtml(url)}">`,
    `<a href="${escapeHtml(url)}" class="trellis-link-preview-title">${escapeHtml(label || url)}</a>`,
    `<span class="trellis-link-preview-domain">${escapeHtml(domain)}</span>`,
    `</div>`
  ].join("");
}

function withLocalExternalLinkPreviews(markdown: string): string {
  const out: string[] = [];
  let inFence = false;

  for (const line of markdown.split("\n")) {
    const trimmed = line.trim();

    if (/^(```|~~~)/.test(trimmed)) {
      inFence = !inFence;
      out.push(line);
      continue;
    }

    if (inFence || !trimmed) {
      out.push(line);
      continue;
    }

    const linked = trimmed.match(/^\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)$/i);
    if (linked) {
      const label = linked[1]?.trim() ?? "";
      const url = linked[2]?.trim() ?? "";
      out.push(`${line}\n\n${externalLinkPreviewHtml(url, label)}`);
      continue;
    }

    const bare = trimmed.match(/^(https?:\/\/[^\s<]+)$/i);
    if (bare) {
      const url = bare[1]?.trim() ?? "";
      out.push(`${line}\n\n${externalLinkPreviewHtml(url, url)}`);
      continue;
    }

    out.push(line);
  }

  return out.join("\n");
}

export function renderWikiMarkdown(
  markdown: string,
  existingSlugs: Set<string>
): MarkdownRenderResult {
  const links: string[] = [];
  const markdownWithPreviews = withLocalExternalLinkPreviews(markdown);
  const preprocessed = markdownWithPreviews.replace(
    /\[\[([^\]]+)\]\]/g,
    (_match, rawTitle: string) => {
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
    }
  );
  const html = marked.parse(preprocessed, {
    breaks: true,
    gfm: true
  }) as string;

  ensureWikiSpanStyleSanitizeHook();

  return {
    html: DOMPurify.sanitize(html),
    links
  };
}
