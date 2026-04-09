export interface ExtractionAttachmentLike {
  kind: "file" | "url";
  label: string;
  text: string;
  sourceUrl?: string;
}

export interface ExtractionMessageLike {
  role: "user" | "assistant";
  content: string;
  attachments?: ExtractionAttachmentLike[];
}

/** Must match the marker checked in `supabase/functions/_shared/models.ts` for session titles. */
export const CHAT_ATTACHMENT_CONTEXT_MARKER = "\n\n---\n\n## Attached context";

export function formatMessageForExtraction(
  message: ExtractionMessageLike
): string {
  if (message.role !== "user" || !message.attachments?.length) {
    return message.content;
  }

  const head = message.content.trim();
  const lead = head.length > 0 ? head : "(No message text.)";

  const parts = message.attachments.map((attachment) => {
    const header =
      attachment.kind === "url"
        ? `### Link: ${attachment.label}${attachment.sourceUrl ? `\n${attachment.sourceUrl}` : ""}`
        : `### File: ${attachment.label}`;

    return `${header}\n\n${attachment.text.trim()}`;
  });

  return `${lead}${CHAT_ATTACHMENT_CONTEXT_MARKER}\n\nThe user attached the following. Use it as context when answering. When it contains durable knowledge, it should also be eligible for their wiki notes (for example summaries of documents or pages).\n\n${parts.join("\n\n---\n\n")}`;
}
