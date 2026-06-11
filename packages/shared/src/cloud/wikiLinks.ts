import { extractWikiLinkTitles, slugifyExtractionTitle } from "../extraction/wikiLinks.ts";

export interface ParsedCloudWikiLink {
  title: string;
  slug: string;
}

export function extractParsedCloudWikiLinks(markdown: string): ParsedCloudWikiLink[] {
  const seen = new Set<string>();
  const parsed: ParsedCloudWikiLink[] = [];

  for (const rawTitle of extractWikiLinkTitles(markdown)) {
    const title = rawTitle.split("|")[0]?.trim() ?? "";

    if (title.length === 0) {
      continue;
    }

    const slug = slugifyExtractionTitle(title);

    if (seen.has(slug)) {
      continue;
    }

    seen.add(slug);
    parsed.push({ title, slug });
  }

  return parsed;
}
