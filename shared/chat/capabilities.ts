/** Aligned with `chatModelIds` in `electron/ipc/types.ts` / Supabase `chat-models.ts`. */
export type ChatModelId =
  | "gpt-4.1-nano"
  | "gpt-4.1-mini"
  | "gpt-4o-mini"
  | "gpt-4.1"
  | "gpt-4o"
  | "claude-3-5-haiku-latest"
  | "claude-3-7-sonnet-latest"
  | "claude-sonnet-4-20250514";

/** Feature flags for chat media — not every model supports every action. */
export interface ChatModelMediaCapabilities {
  /** User can attach images for vision-capable chat completions. */
  visionInput: boolean;
  /** Inline image generation (OpenAI Images API). */
  imageGeneration: boolean;
  /** Speech-to-text (cloud; no strong local equivalent in v1). */
  speechToText: boolean;
  /** Text-to-speech playback. */
  textToSpeech: boolean;
}

const capsByModel: Record<ChatModelId, ChatModelMediaCapabilities> = {
  "gpt-4.1-nano": {
    visionInput: false,
    imageGeneration: false,
    speechToText: true,
    textToSpeech: true
  },
  "gpt-4.1-mini": {
    visionInput: false,
    imageGeneration: false,
    speechToText: true,
    textToSpeech: true
  },
  "gpt-4o-mini": {
    visionInput: true,
    imageGeneration: false,
    speechToText: true,
    textToSpeech: true
  },
  "gpt-4.1": {
    visionInput: false,
    imageGeneration: false,
    speechToText: true,
    textToSpeech: true
  },
  "gpt-4o": {
    visionInput: true,
    imageGeneration: true,
    speechToText: true,
    textToSpeech: true
  },
  "claude-3-5-haiku-latest": {
    visionInput: true,
    imageGeneration: false,
    speechToText: true,
    textToSpeech: true
  },
  "claude-3-7-sonnet-latest": {
    visionInput: true,
    imageGeneration: false,
    speechToText: true,
    textToSpeech: true
  },
  "claude-sonnet-4-20250514": {
    visionInput: true,
    imageGeneration: false,
    speechToText: true,
    textToSpeech: true
  }
};

export function getChatModelMediaCapabilities(model: string): ChatModelMediaCapabilities {
  const known = capsByModel[model as ChatModelId];

  if (known) {
    return known;
  }

  return {
    visionInput: false,
    imageGeneration: false,
    speechToText: false,
    textToSpeech: false
  };
}
