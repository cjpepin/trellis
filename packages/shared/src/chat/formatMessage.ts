export interface ExtractionAttachmentLike {
  kind: "file" | "url";
  label: string;
  text: string;
  sourceUrl?: string;
}

export interface ExtractionMediaLike {
  kind: "image" | "generated_image";
  label: string;
}

export interface ExtractionMessageLike {
  role: "user" | "assistant";
  content: string;
  attachments?: ExtractionAttachmentLike[];
  mediaArtifacts?: ExtractionMediaLike[];
}

/** Must match the marker used when building chat context / session titles (see `deriveSessionTitle`). */
export const CHAT_ATTACHMENT_CONTEXT_MARKER = "\n\n---\n\n## Attached context";

export function formatMessageForExtraction(
  message: ExtractionMessageLike
): string {
  const mediaSuffix =
    message.role === "user" && (message.mediaArtifacts?.length ?? 0) > 0
      ? `\n\n[User included ${message.mediaArtifacts?.length} image(s) in chat; only descriptive text appears here.]`
      : "";

  if (message.role !== "user" || !message.attachments?.length) {
    const head = message.content.trim();
    const lead = head.length > 0 ? head : "";

    if (message.role === "user" && !lead && (message.mediaArtifacts?.length ?? 0) > 0) {
      return `(No message text.)${mediaSuffix}`.trim();
    }

    return `${lead}${mediaSuffix}`.trim();
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

  return `${lead}${CHAT_ATTACHMENT_CONTEXT_MARKER}\n\nThe user attached the following. Use it as context when answering. When it contains durable knowledge, it should also be eligible to save into their notes (for example summaries of documents or pages).\n\n${parts.join("\n\n---\n\n")}${mediaSuffix}`;
}
