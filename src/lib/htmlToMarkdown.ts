import TurndownService from "turndown";
import { gfm } from "turndown-plugin-gfm";

const turndown = new TurndownService({
  headingStyle: "atx",
  bulletListMarker: "-",
  codeBlockStyle: "fenced"
});

gfm(turndown);

turndown.addRule("wikiLink", {
  filter(node) {
    return (
      node.nodeName === "A" &&
      (node.getAttribute("href")?.startsWith("#/wiki?note=") ?? false)
    );
  },
  replacement(content) {
    return `[[${content}]]`;
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
