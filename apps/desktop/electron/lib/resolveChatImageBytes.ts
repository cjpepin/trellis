import { createClient } from "@supabase/supabase-js";
import { readMediaCacheBytes } from "./chatMediaCache";
import type { AuthSessionSnapshot } from "../ipc/types";

const NOTE_ASSETS = "note-assets" as const;

const imageExtToMime: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp"
};

function inferImageMimeFromObjectPath(objectPath: string): string | null {
  const lower = objectPath.toLowerCase();
  for (const [ext, mime] of Object.entries(imageExtToMime)) {
    if (lower.endsWith(ext)) {
      return mime;
    }
  }
  return null;
}

function getSupabaseEnv(): { url: string; key: string } | null {
  const url = process.env.VITE_SUPABASE_URL?.trim();
  const key = process.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim();

  if (!url || !key) {
    return null;
  }

  return { url, key };
}

async function downloadNoteAssetBytes(
  getAuth: () => AuthSessionSnapshot | null,
  objectPath: string
): Promise<{ bytes: Buffer; mimeType: string } | null> {
  const env = getSupabaseEnv();
  if (!env) {
    return null;
  }

  const session = getAuth();

  if (!session?.accessToken) {
    return null;
  }

  const supabase = createClient(env.url, env.key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
  });

  await supabase.auth.setSession({
    access_token: session.accessToken,
    refresh_token: session.refreshToken
  });

  const { data, error } = await supabase.storage.from(NOTE_ASSETS).download(objectPath.trim());

  if (error || !data) {
    return null;
  }

  const ab = await data.arrayBuffer();
  const bytes = Buffer.from(ab);
  let mimeType = data.type?.split(";")[0]?.trim() ?? "";

  if (!mimeType || mimeType === "application/octet-stream") {
    mimeType = inferImageMimeFromObjectPath(objectPath) ?? "application/octet-stream";
  }

  return { bytes, mimeType };
}

/**
 * Resolves image bytes for vault operations: local media cache first, then Supabase `note-assets`
 * when `noteAssetsPath` is set (e.g. chat image synced from another device).
 */
export async function resolveChatImageBytes(
  getAuth: () => AuthSessionSnapshot | null,
  input: { fileId: string; noteAssetsPath?: string }
): Promise<{ bytes: Buffer; mimeType: string } | null> {
  const fromCache = await readMediaCacheBytes(input.fileId);

  if (fromCache) {
    return { bytes: fromCache.bytes, mimeType: fromCache.mimeType };
  }

  const path = input.noteAssetsPath?.trim();
  if (path) {
    return downloadNoteAssetBytes(getAuth, path);
  }

  return null;
}
