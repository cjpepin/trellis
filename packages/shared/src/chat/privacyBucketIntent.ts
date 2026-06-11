/**
 * Heuristic: the user likely expects wiki / vault note context in the assistant reply.
 * Used to warn when Chat privacy is Off and no note excerpts are sent to the cloud.
 */
export function messageLikelyExpectsBucketContextForChat(content: string): boolean {
  const trimmed = content.trim();
  if (trimmed.length < 6) {
    return false;
  }

  if (/\[\[[^\]]+\]\]/.test(trimmed)) {
    return true;
  }

  const lower = trimmed.toLowerCase();

  if (
    /\b(?:my vault|our wiki|the wiki|wiki notes|my notes|my note\b|saved notes|in my notes|across my notes|from my notes|all notes|every note|note titled|which note|what note|summarize (?:all )?my notes|notes (?:are|were|about)|backlink|backlinks|inbound link|most linked|graph of notes)\b/.test(
      lower
    )
  ) {
    return true;
  }

  if (/\b(?:vault|wiki)\b/.test(lower) && trimmed.length >= 24) {
    return true;
  }

  return false;
}
