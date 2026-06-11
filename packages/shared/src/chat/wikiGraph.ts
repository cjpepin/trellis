/**
 * Wiki link graph helpers (1-hop expansion). Edge endpoints are note slugs.
 */

export interface WikiGraphEdge {
  source: string;
  target: string;
}

/**
 * Return slugs one hop from any seed, excluding self-links, limited to validSlugs, max maxResults.
 */
export function oneHopWikiNeighborSlugs(
  seedSlugs: string[],
  edges: WikiGraphEdge[],
  options: { validSlugs: Set<string>; maxResults: number }
): string[] {
  const seedSet = new Set(seedSlugs.filter((s) => s.length > 0));
  const out: string[] = [];
  const outSet = new Set<string>();

  for (const seed of seedSet) {
    for (const edge of edges) {
      const neighbor =
        edge.source === seed ? edge.target : edge.target === seed ? edge.source : null;
      if (!neighbor || neighbor === seed) {
        continue;
      }
      if (!options.validSlugs.has(neighbor) || outSet.has(neighbor) || seedSet.has(neighbor)) {
        continue;
      }
      outSet.add(neighbor);
      out.push(neighbor);
      if (out.length >= options.maxResults) {
        return out;
      }
    }
  }
  return out;
}

/**
 * De-dupe and cap seeds: explicit wikilinks + pins first, then recent vault activity, then retrieval hits.
 */
export function pickSeedsForGraphExpansion(input: {
  explicitSlugs: string[];
  recentSlugs: string[];
  topRetrievalSlugs: string[];
  maxSeeds: number;
}): string[] {
  const out: string[] = [];
  const seen = new Set<string>();

  for (const s of input.explicitSlugs) {
    if (!s || seen.has(s)) {
      continue;
    }
    seen.add(s);
    out.push(s);
    if (out.length >= input.maxSeeds) {
      return out;
    }
  }

  for (const s of input.recentSlugs) {
    if (!s || seen.has(s)) {
      continue;
    }
    seen.add(s);
    out.push(s);
    if (out.length >= input.maxSeeds) {
      return out;
    }
  }

  for (const s of input.topRetrievalSlugs) {
    if (!s || seen.has(s)) {
      continue;
    }
    seen.add(s);
    out.push(s);
    if (out.length >= input.maxSeeds) {
      return out;
    }
  }

  return out;
}
