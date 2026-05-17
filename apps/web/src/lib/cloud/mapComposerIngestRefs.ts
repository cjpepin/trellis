import type { ExtractionContextNote } from "@trellis/shared/extraction/contracts";
import type { CloudChatContextReference } from "@trellis/shared/cloud/types";

export function mapCloudRetrievalRefsToExtractionNotes(
  references: CloudChatContextReference[],
  limit: number
): ExtractionContextNote[] {
  return references
    .filter((r) => r.type === "note" && typeof r.slug === "string" && r.slug.length > 0)
    .slice(0, limit)
    .map((r) => ({
      slug: r.slug as string,
      title: r.title,
      tags: r.tags ?? [],
      headingPath: r.title,
      content: r.content,
      score: r.isExplicitMatch ? 20 : 8,
      updatedAt: undefined,
      isExplicitMatch: r.isExplicitMatch
    }));
}
