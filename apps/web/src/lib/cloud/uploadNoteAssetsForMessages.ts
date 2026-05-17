import type { ChatMediaArtifact, MessageRecord } from "@trellis/contracts";
import { readChatMediaDataUrl } from "@/lib/chat/readChatMediaDataUrl";
import { getSupabase, hasSupabaseConfig } from "@/lib/supabase";

const NOTE_ASSETS_BUCKET = "note-assets" as const;

function extensionForImageMime(mimeType: string): string {
  const m = mimeType.toLowerCase().split(";")[0]?.trim() ?? "";
  if (m === "image/jpeg" || m === "image/jpg") {
    return ".jpg";
  }
  if (m === "image/png") {
    return ".png";
  }
  if (m === "image/gif") {
    return ".gif";
  }
  if (m === "image/webp") {
    return ".webp";
  }
  if (m === "image/svg+xml") {
    return ".svg";
  }
  return ".bin";
}

async function uploadOneArtifact(
  workspaceId: string,
  sessionId: string,
  messageId: string,
  artifact: ChatMediaArtifact
): Promise<ChatMediaArtifact> {
  if (artifact.pendingGeneration) {
    return artifact;
  }

  const existing = artifact.noteAssetsPath?.trim();
  if (existing) {
    return artifact;
  }

  const dataUrl = await readChatMediaDataUrl(artifact.fileId);
  if (!dataUrl) {
    throw new Error(
      "An image could not be read from this device. Remove it and attach the image again."
    );
  }

  const response = await fetch(dataUrl);
  const blob = await response.blob();
  const objectPath = `${workspaceId}/chat-media/${sessionId}/${messageId}/${artifact.fileId}${extensionForImageMime(artifact.mimeType)}`;
  const contentType =
    artifact.mimeType.split(";")[0]?.trim() || blob.type || "application/octet-stream";

  const { error } = await getSupabase().storage.from(NOTE_ASSETS_BUCKET).upload(objectPath, blob, {
    cacheControl: "3600",
    contentType,
    upsert: true
  });

  if (error) {
    throw new Error(error.message || "Could not upload an image to cloud storage.");
  }

  return { ...artifact, noteAssetsPath: objectPath };
}

/**
 * For cloud-backed sessions, ensures each non-pending image artifact has a `noteAssetsPath`
 * in Supabase so other devices can render the same conversation.
 */
export async function withUploadedNoteAssets(
  workspaceId: string,
  sessionId: string,
  messages: MessageRecord[]
): Promise<MessageRecord[]> {
  if (!hasSupabaseConfig()) {
    return messages;
  }

  const next: MessageRecord[] = [];

  for (const message of messages) {
    const media = message.mediaArtifacts;
    if (!media?.length) {
      next.push(message);
      continue;
    }

    const mediaArtifacts: ChatMediaArtifact[] = [];
    for (const artifact of media) {
      mediaArtifacts.push(
        await uploadOneArtifact(workspaceId, sessionId, message.id, artifact)
      );
    }
    next.push({ ...message, mediaArtifacts });
  }

  return next;
}
