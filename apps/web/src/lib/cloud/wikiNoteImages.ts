import { getSupabase, hasSupabaseConfig } from "@/lib/supabase";

const NOTE_ASSETS_BUCKET = "note-assets" as const;

/** Markdown `img` src prefix; remainder is the Supabase `note-assets` object path. */
export const WIKI_CLOUD_ASSET_PREFIX = ".trellis-cloud-asset/";

const MAX_WIKI_IMAGE_BYTES = 12 * 1024 * 1024;

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
  throw new Error("Only PNG, JPEG, WebP, and GIF images can be attached to notes.");
}

function assertWikiImageFile(file: File): void {
  const t = file.type.toLowerCase();
  if (!t.startsWith("image/")) {
    throw new Error("Choose an image file.");
  }
  extensionForImageMime(t);
  if (file.size > MAX_WIKI_IMAGE_BYTES) {
    throw new Error("That image is too large to attach.");
  }
}

function wikiNotesKeyFromSlug(slug: string): string {
  const parts = slug
    .trim()
    .split("/")
    .filter(Boolean)
    .map((p) => encodeURIComponent(p));
  return parts.length > 0 ? parts.join("/") : "note";
}

export function tryParseCloudNoteAssetStoragePath(src: string): string | null {
  const t = src.trim();
  if (!t.startsWith(WIKI_CLOUD_ASSET_PREFIX)) {
    return null;
  }
  const path = t.slice(WIKI_CLOUD_ASSET_PREFIX.length).trim();
  return path.length > 0 ? path : null;
}

export async function uploadWikiNoteImage(input: {
  workspaceId: string;
  noteSlug: string;
  file: File;
  alt?: string;
}): Promise<{ markdownPath: string; alt: string }> {
  if (!hasSupabaseConfig()) {
    throw new Error("Cloud storage is not configured.");
  }

  assertWikiImageFile(input.file);

  const name = input.file.name?.trim() || "image";
  const alt =
    input.alt?.trim() ||
    name.replace(/\.[a-z0-9]+$/i, "").trim() ||
    "Attached image";

  const ext = extensionForImageMime(input.file.type);
  const objectPath = `${input.workspaceId}/wiki-notes/${wikiNotesKeyFromSlug(input.noteSlug)}/${crypto.randomUUID()}${ext}`;
  const contentType = input.file.type.split(";")[0]?.trim() || "application/octet-stream";

  const { error } = await getSupabase().storage.from(NOTE_ASSETS_BUCKET).upload(objectPath, input.file, {
    cacheControl: "3600",
    contentType,
    upsert: true
  });

  if (error) {
    throw new Error(error.message || "Could not upload that image.");
  }

  return {
    markdownPath: `${WIKI_CLOUD_ASSET_PREFIX}${objectPath}`,
    alt
  };
}
