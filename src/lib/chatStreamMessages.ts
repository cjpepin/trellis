import type { ChatStreamPayloadMessage, MessageRecord } from "@electron/ipc/types";
import { formatMessageForApi } from "@/lib/chatAttachments";

export function messageRecordsToStreamPayload(messages: MessageRecord[]): ChatStreamPayloadMessage[] {
  return messages.map((message) => {
    const imageFileIds =
      message.role === "user" && message.mediaArtifacts && message.mediaArtifacts.length > 0
        ? message.mediaArtifacts
            .filter((artifact) => artifact.kind === "image")
            .map((artifact) => artifact.fileId)
        : undefined;

    return {
      role: message.role,
      content: formatMessageForApi(message),
      ...(imageFileIds && imageFileIds.length > 0 ? { imageFileIds } : {})
    };
  });
}
