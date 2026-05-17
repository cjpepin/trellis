import type { ChatAttachment, IngestedDraft, MessageRecord } from "@trellis/contracts";
import {
  CHAT_ATTACHMENT_CONTEXT_MARKER,
  formatMessageForExtraction
} from "@trellis/shared/chat/formatMessage";
import { maxChatComposerAttachments } from "@trellis/shared/chat/attachmentLimits";

/** Client-only id for pending chips in the composer. */
export type PendingChatAttachment = ChatAttachment & {
  clientId: string;
  /** Stripped by `toChatAttachments` before persisting messages. */
  ingestDraft?: IngestedDraft;
};

export { maxChatComposerAttachments };

/** Pending image already written to the app media cache via IPC. */
export type PendingImageAttachment = {
  clientId: string;
  fileId: string;
  mimeType: string;
  label: string;
};
export { CHAT_ATTACHMENT_CONTEXT_MARKER };

export function toChatAttachments(pending: PendingChatAttachment[]): ChatAttachment[] {
  return pending.map(({ clientId: _clientId, ingestDraft: _ingestDraft, ...rest }): ChatAttachment => rest);
}

export function collectIngestDrafts(pending: PendingChatAttachment[]): IngestedDraft[] {
  return pending
    .map((item) => item.ingestDraft)
    .filter((draft): draft is IngestedDraft => draft !== undefined);
}

export function formatMessageForApi(
  message: Pick<MessageRecord, "role" | "content" | "attachments">
): string {
  return formatMessageForExtraction(message);
}
