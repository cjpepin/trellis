import { demoSessionId } from "@trellis/demo-local";
import type { ChatStreamPayloadMessage, MessageRecord } from "@trellis/contracts";
import { demoApiBase } from "./config";

export async function streamDemoChatOverHttp(input: {
  messages: ChatStreamPayloadMessage[];
  messageRecords: MessageRecord[];
  onToken: (token: string) => void;
}): Promise<void> {
  const base = demoApiBase();
  if (!base) {
    throw new Error("Demo chat API is not configured.");
  }

  const response = await fetch(`${base}/chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Demo-Session": demoSessionId(),
    },
    body: JSON.stringify({
      messages: input.messages.map((message) => ({
        role: message.role,
        content: message.content,
      })),
    }),
  });

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(payload?.error ?? "Demo chat request failed.");
  }

  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error("Demo chat stream is unavailable.");
  }

  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const chunks = buffer.split("\n\n");
    buffer = chunks.pop() ?? "";

    for (const chunk of chunks) {
      const line = chunk
        .split("\n")
        .find((entry) => entry.startsWith("data: "));
      if (!line) continue;
      const payload = line.slice(6);
      if (payload === "[DONE]") {
        return;
      }
      try {
        const parsed = JSON.parse(payload) as { token?: string };
        if (parsed.token) {
          input.onToken(parsed.token);
        }
      } catch {
        // ignore malformed chunks
      }
    }
  }
}
