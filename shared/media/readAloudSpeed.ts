/** User-facing tiers for OpenAI `audio/speech` synthesis speed (see MediaSpeechInput). */

export const READ_ALOUD_SPEED_TIERS = [1, 2, 3, 4, 5] as const;
export type ReadAloudSpeedTier = (typeof READ_ALOUD_SPEED_TIERS)[number];

/** Default: Medium (OpenAI speed 1.0). */
export const READ_ALOUD_SPEED_DEFAULT_TIER: ReadAloudSpeedTier = 3;

/** Maps each tier to OpenAI `speed` (typically 0.25–4.0). */
const OPENAI_SPEED_BY_TIER: Record<ReadAloudSpeedTier, number> = {
  1: 0.5,
  2: 1,
  3: 1,
  4: 1.5,
  5: 2
};

export function readAloudSpeedTierToOpenAiSpeed(tier: ReadAloudSpeedTier): number {
  return OPENAI_SPEED_BY_TIER[tier];
}

export function normalizeReadAloudSpeedTier(value: unknown): ReadAloudSpeedTier {
  if (value === 1 || value === 2 || value === 3 || value === 4 || value === 5) {
    return value;
  }
  return READ_ALOUD_SPEED_DEFAULT_TIER;
}

export const READ_ALOUD_SPEED_LISTBOX_OPTIONS: Array<{
  id: "1" | "2" | "3" | "4" | "5";
  label: string;
}> = [
  { id: "1", label: "Slowest (0.5)" },
  { id: "2", label: "Slower (1)" },
  { id: "3", label: "Medium (1)" },
  { id: "4", label: "Faster (1.5)" },
  { id: "5", label: "Fastest (2)" }
];

export function readAloudSpeedTierToListId(tier: ReadAloudSpeedTier): "1" | "2" | "3" | "4" | "5" {
  return String(tier) as "1" | "2" | "3" | "4" | "5";
}

export function readAloudListIdToTier(id: string): ReadAloudSpeedTier {
  return normalizeReadAloudSpeedTier(Number(id));
}
