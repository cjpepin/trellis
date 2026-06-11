import type { ChatAttachmentPickResult } from "@trellis/contracts";
import {
  maxChatAttachmentContextChars,
  maxChatPickPdfBytes,
  maxChatPickTextFileBytes
} from "@trellis/shared/chat/attachmentLimits";

function truncateText(value: string): string {
  if (value.length <= maxChatAttachmentContextChars) {
    return value;
  }

  return `${value.slice(0, maxChatAttachmentContextChars)}\n\n[…truncated for chat context]`;
}

/**
 * Read a user-picked file in the browser for chat context (UTF-8 text-like formats and PDF text extract).
 */
export async function readComposerAttachmentFile(file: File): Promise<ChatAttachmentPickResult> {
  const name = file.name?.trim().length > 0 ? file.name : "attachment";
  const ext = name.toLowerCase().split(".").pop() ?? "";

  if (ext === "pdf") {
    const buf = await file.arrayBuffer();

    if (buf.byteLength > maxChatPickPdfBytes) {
      throw new Error("That PDF is too large to attach.");
    }

    try {
      const { extractPdfTextInBrowser } = await import("@/lib/chat/extractPdfTextInBrowser");
      const raw = await extractPdfTextInBrowser(buf);
      const content = raw.trim();
      const title = name.replace(/\.pdf$/i, "");
      const contextPreview =
        content.length > 0 ? content : "(no extractable text in this PDF)";

      return {
        name,
        text: truncateText(contextPreview),
        ...(content.length > 0
          ? {
              ingestDraft: {
                title,
                content,
                sourcePath: `browser-upload:${name}`,
                sourceType: "pdf" as const
              }
            }
          : {})
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : "";
      if (/password|encrypt/i.test(msg)) {
        throw new Error("That PDF is password-protected and can’t be read in the browser.");
      }
      throw new Error("Could not read text from that PDF.");
    }
  }

  const buf = await file.arrayBuffer();

  if (buf.byteLength > maxChatPickTextFileBytes) {
    throw new Error("That file is too large to attach.");
  }

  const text = new TextDecoder("utf-8", { fatal: false }).decode(buf);

  return {
    name,
    text: truncateText(text.trim().length > 0 ? text : "(empty file)")
  };
}
