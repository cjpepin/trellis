import TurndownService from "turndown";
import { gfm } from "turndown-plugin-gfm";
import { isInternalNoteHashHref } from "./noteRoutes";

const turndown = new TurndownService({
  headingStyle: "atx",
  bulletListMarker: "-",
  codeBlockStyle: "fenced"
});

gfm(turndown);

/**
 * Block round-trip: prefer `$$` (tight spacing) but ` ```latex` when `$$` or fences would break.
 * Inline: prefer `\\( … \\)` so TeX with `$` does not corrupt other `$` math in the note.
 */
function texToMarkdownDisplayBlock(tex: string, origin: "fence" | "delim"): string {
  if (origin === "fence" || tex.includes("```") || tex.includes("$$") || tex.includes("\n")) {
    return `\n\`\`\`latex\n${tex}\n\`\`\`\n`;
  }
  return `\n$$\n${tex}\n$$`;
}

function texToMarkdownInline(tex: string): string {
  return `\\(${tex}\\)`;
}

turndown.addRule("linkPreview", {
  filter(node) {
    return (
      node.nodeName === "DIV" &&
      node instanceof HTMLElement &&
      node.dataset.trellisLinkPreview === "true"
    );
  },
  replacement() {
    return "";
  }
});

turndown.addRule("wikiLink", {
  filter(node) {
    const href = node.getAttribute("href") ?? "";
    return node.nodeName === "A" && isInternalNoteHashHref(href);
  },
  replacement(content) {
    return `[[${content}]]`;
  }
});

turndown.addRule("noteImage", {
  filter(node) {
    return (
      node.nodeName === "IMG" &&
      node instanceof HTMLElement &&
      Boolean(node.dataset.trellisImageSrc)
    );
  },
  replacement(_content, node) {
    if (!(node instanceof HTMLImageElement)) {
      return "";
    }

    const src = node.dataset.trellisImageSrc ?? node.getAttribute("src") ?? "";
    const alt = (node.getAttribute("alt") ?? "Attached image")
      .replaceAll("[", "\\[")
      .replaceAll("]", "\\]");

    return src ? `![${alt}](${src})` : "";
  }
});

turndown.addRule("richTable", {
  filter(node) {
    if (node.nodeName !== "TABLE" || !(node instanceof HTMLElement)) {
      return false;
    }

    return Boolean(node.querySelector("colgroup, col[style], th[style], td[style]"));
  },
  replacement(_content, node) {
    if (!(node instanceof HTMLElement)) {
      return "";
    }

    return `\n\n${node.outerHTML}\n\n`;
  }
});

turndown.addRule("trellisKatexDisplay", {
  filter(node) {
    return (
      node.nodeName === "DIV" &&
      node instanceof HTMLElement &&
      node.classList.contains("trellis-math-display") &&
      typeof node.dataset.trellisTex === "string"
    );
  },
  replacement(_content, node) {
    if (!(node instanceof HTMLElement)) {
      return "";
    }

    const tex = node.dataset.trellisTex ?? "";
    if (node.dataset.trellisMathOrigin === "fence-latex") {
      return texToMarkdownDisplayBlock(tex, "fence");
    }

    return texToMarkdownDisplayBlock(tex, "delim");
  }
});

turndown.addRule("trellisKatexInline", {
  filter(node) {
    return (
      node.nodeName === "SPAN" &&
      node instanceof HTMLElement &&
      node.classList.contains("trellis-math-inline") &&
      typeof node.dataset.trellisTex === "string"
    );
  },
  replacement(_content, node) {
    if (!(node instanceof HTMLElement)) {
      return "";
    }

    const tex = node.dataset.trellisTex ?? "";
    return texToMarkdownInline(tex);
  }
});

turndown.addRule("colorSpan", {
  filter(node) {
    if (node.nodeName !== "SPAN") {
      return false;
    }

    const style = node.getAttribute("style");

    if (!style) {
      return false;
    }

    return /color\s*:/i.test(style);
  },
  replacement(_content, node) {
    if (!(node instanceof HTMLElement)) {
      return "";
    }

    return node.outerHTML;
  }
});

export function htmlToMarkdown(html: string): string {
  return turndown.turndown(html);
}
