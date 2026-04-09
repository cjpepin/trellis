import type { ChatAttachment, MessageRecord } from "@electron/ipc/types";
import {
  CHAT_ATTACHMENT_CONTEXT_MARKER,
  formatMessageForExtraction
} from "@shared/chat/formatMessage";

/** Client-only id for pending chips in the composer. */
export type PendingChatAttachment = ChatAttachment & { clientId: string };
export { CHAT_ATTACHMENT_CONTEXT_MARKER };

export function toChatAttachments(pending: PendingChatAttachment[]): ChatAttachment[] {
  return pending.map(
    ({ clientId: _clientId, ...rest }): ChatAttachment => rest
  );
}

export function formatMessageForApi(
  message: Pick<MessageRecord, "role" | "content" | "attachments">
): string {
  return formatMessageForExtraction(message);
}
