const stopWords = new Set([
  "about",
  "after",
  "again",
  "being",
  "could",
  "from",
  "have",
  "into",
  "just",
  "more",
  "than",
  "that",
  "their",
  "there",
  "these",
  "they",
  "this",
  "what",
  "with",
  "would",
  "your",
  "want",
  "make",
  "need",
  "help",
  "please",
  "should"
]);

export function tokenize(value: string): string[] {
  return [
    ...new Set(
      (value.toLowerCase().match(/[a-z][a-z0-9-]{2,}/g) ?? []).filter(
        (token) => !stopWords.has(token)
      )
    )
  ];
}

export function normalizeForPhraseSearch(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function countSharedTokens(left: string[], right: string[]): number {
  const rightSet = new Set(right);
  return left.reduce((total, token) => total + (rightSet.has(token) ? 1 : 0), 0);
}

export function jaccardSimilarity(left: string[], right: string[]): number {
  const leftSet = new Set(left);
  const rightSet = new Set(right);
  const union = new Set([...leftSet, ...rightSet]);

  if (union.size === 0) {
    return 0;
  }

  let intersection = 0;

  for (const token of leftSet) {
    if (rightSet.has(token)) {
      intersection += 1;
    }
  }

  return intersection / union.size;
}

export function truncateForContext(value: string, maxChars: number): string {
  const normalized = value.replace(/\s+\n/g, "\n").trim();

  if (normalized.length <= maxChars) {
    return normalized;
  }

  return `${normalized.slice(0, maxChars).trimEnd()}\n\n[…truncated]`;
}

export function takeFirstSentence(value: string, fallbackChars = 180): string {
  const normalized = value.replace(/\s+/g, " ").trim();

  if (!normalized) {
    return "";
  }

  const sentence = normalized.split(/(?<=[.!?])\s+/)[0]?.trim() ?? "";

  if (sentence.length >= 12) {
    return sentence;
  }

  return normalized.slice(0, fallbackChars).trim();
}
