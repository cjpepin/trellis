import TurndownService from "turndown";

const turndown = new TurndownService({
  headingStyle: "atx",
  bulletListMarker: "-",
  codeBlockStyle: "fenced"
});

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

export function htmlToMarkdown(html: string): string {
  return turndown.turndown(html);
}
