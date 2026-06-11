import type { ChatMediaArtifact } from "@trellis/contracts";
import { readChatMediaDataUrl } from "@/lib/chat/readChatMediaDataUrl";
import { getSupabase, hasSupabaseConfig } from "@/lib/supabase";

const NOTE_ASSETS_BUCKET = "note-assets" as const;
const SIGNED_URL_TTL_SEC = 3600;

/**
 * Resolves a display URL for a chat image: Supabase `note-assets` when `noteAssetsPath` is
 * set (multi-device), otherwise the local media cache.
 */
export async function resolveChatMediaDataUrl(artifact: ChatMediaArtifact): Promise<string | null> {
  if (artifact.pendingGeneration) {
    return null;
  }

  const path = artifact.noteAssetsPath?.trim();
  if (path && hasSupabaseConfig()) {
    const { data, error } = await getSupabase().storage
      .from(NOTE_ASSETS_BUCKET)
      .createSignedUrl(path, SIGNED_URL_TTL_SEC);

    if (!error && data?.signedUrl) {
      return data.signedUrl;
    }
  }

  return readChatMediaDataUrl(artifact.fileId);
}
