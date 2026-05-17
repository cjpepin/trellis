import type { ExtractionResponse, ExtractionUpdate } from "./contracts.ts";
import { normalizeTitleKey } from "./wikiLinks.ts";

/**
 * Dedupes redundant `create` ops and keeps strand writes consistent with session history:
 * - With no prior session notes: the first `create` in this response is the anchor; later
 *   `create` ops in the same response become `append` to that anchor (one new file per batch).
 * - With one or more prior session notes: a `create` whose **targetTitle** matches an existing
 *   strand note title (normalized) becomes `append` to that slug; other `create` ops are kept so
 *   a new substantive topic in the same chat can become a new strand note.
 *
 * `transcriptStartIndex` is retained for call-site compatibility only.
 */
export function foldIncrementalCreatesOntoSessionAnchor(
  response: ExtractionResponse,
  input: {
    transcriptStartIndex: number;
    priorSessionSlugs: string[];
    noteTitleBySlug: Map<string, string>;
  }
): ExtractionResponse {
  void input.transcriptStartIndex;

  if (input.priorSessionSlugs.length === 0) {
    let anchorSlug: string | null = null;
    let anchorTitle: string | null = null;
    const updates: ExtractionUpdate[] = [];

    for (const u of response.updates) {
      if (u.operation === "create") {
        if (anchorSlug === null) {
          anchorSlug = u.targetSlug;
          anchorTitle = u.targetTitle;
          updates.push(u);
          continue;
        }
        updates.push({
          ...u,
          operation: "append",
          targetSlug: anchorSlug,
          targetTitle: anchorTitle ?? u.targetTitle
        });
        continue;
      }
      updates.push(u);
    }

    return { ...response, updates };
  }

  const titleToSlug = new Map<string, string>();
  for (const slug of input.priorSessionSlugs) {
    const title = input.noteTitleBySlug.get(slug);
    if (title) {
      titleToSlug.set(normalizeTitleKey(title), slug);
    }
  }

  const updates: ExtractionUpdate[] = [];

  for (const u of response.updates) {
    if (u.operation === "create") {
      const key = normalizeTitleKey(u.targetTitle);
      const matchedSlug = titleToSlug.get(key);
      if (matchedSlug) {
        updates.push({
          ...u,
          operation: "append",
          targetSlug: matchedSlug,
          targetTitle: input.noteTitleBySlug.get(matchedSlug) ?? u.targetTitle
        });
        continue;
      }
    }
    updates.push(u);
  }

  return { ...response, updates };
}
