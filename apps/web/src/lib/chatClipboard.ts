import type { MessageRecord } from "@trellis/contracts";

function formatSingleMessage(message: MessageRecord): string {
  const label = message.role === "user" ? "You" : "Assistant";
  const body = message.content.trim();
  const lines: string[] = [];

  if (message.attachments?.length) {
    const names = message.attachments.map((a) => a.label).join(", ");
    lines.push(`Attachments: ${names}`);
  }
  if (message.mediaArtifacts?.length) {
    lines.push(
      message.mediaArtifacts.length === 1
        ? "1 image in this message"
        : `${message.mediaArtifacts.length} images in this message`
    );
  }

  const meta = lines.length > 0 ? `\n\n[${lines.join("; ")}]` : "";
  return `${label}:\n${body.length > 0 ? body : "(empty)"}${meta}`;
}

/**
 * Plain-text transcript for clipboard export: session title (if any) plus labeled messages.
 */
export function formatChatTranscriptForClipboard(
  messages: MessageRecord[],
  sessionTitle?: string | null
): string {
  const blocks: string[] = [];
  const title = sessionTitle?.trim();
  if (title) {
    blocks.push(title);
  }
  blocks.push(messages.map(formatSingleMessage).join("\n\n"));
  return blocks.filter((part) => part.length > 0).join("\n\n");
}
