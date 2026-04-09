const wikiLinkPattern = /\[\[([^[\]]+)\]\]/g;

export function extractWikiLinkTitles(value: string): string[] {
  return [...value.matchAll(wikiLinkPattern)]
    .map((match) => match[1]?.trim() ?? "")
    .filter((title) => title.length > 0);
}

export function normalizeTitleKey(value: string): string {
  return value.trim().toLowerCase();
}

export function slugifyExtractionTitle(value: string): string {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return slug || "untitled-note";
}
