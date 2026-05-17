/**
 * Maps a chat model id string to the vendor that serves it.
 * Shared between renderer and Electron main (avoid importing IPC-only modules in shared code).
 */
export function providerForChatModel(model: string): "openai" | "anthropic" | null {
  if (model.startsWith("gpt-") || model.startsWith("o1") || model.startsWith("o3")) {
    return "openai";
  }
  if (model.startsWith("claude-")) {
    return "anthropic";
  }
  return null;
}
