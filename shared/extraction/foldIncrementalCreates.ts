import type { ExtractionResponse, ExtractionUpdate } from "./contracts";
import { normalizeTitleKey } from "./wikiLinks";

/**
 * Enforces at most one new strand `create` per chat session:
 * - With no prior session notes: the first `create` in this response is the anchor; later
 *   `create` ops in the same response become `append` to that anchor.
 * - With exactly one prior strand note: extra `create` ops targeting other slugs fold onto it.
 * - With multiple prior session notes: `create` ops whose title matches an existing strand
 *   title fold onto that slug; otherwise left unchanged.
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

  if (input.priorSessionSlugs.length === 1) {
    const anchorSlug = input.priorSessionSlugs[0];
    if (!anchorSlug) {
      return response;
    }

    const anchorTitle = input.noteTitleBySlug.get(anchorSlug) ?? anchorSlug;
    const updates: ExtractionUpdate[] = [];

    for (const u of response.updates) {
      if (u.operation === "create" && u.targetSlug !== anchorSlug) {
        updates.push({
          ...u,
          operation: "append",
          targetSlug: anchorSlug,
          targetTitle: anchorTitle
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
