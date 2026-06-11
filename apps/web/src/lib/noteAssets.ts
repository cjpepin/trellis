import { tryParseCloudNoteAssetStoragePath } from "@/lib/cloud/wikiNoteImages";
import { hasElectronPreloadBridge } from "@/lib/platform/runtime";
import { getSupabase, hasSupabaseConfig } from "@/lib/supabase";

function isLocalNoteAssetSrc(src: string): boolean {
  const lower = src.trim().toLowerCase();
  return (
    lower.length > 0 &&
    !lower.startsWith("http://") &&
    !lower.startsWith("https://") &&
    !lower.startsWith("data:") &&
    !lower.startsWith("blob:") &&
    !lower.startsWith("file:")
  );
}

const NOTE_ASSETS_SIGNED_URL_TTL_SEC = 3600;

export function resolveRenderedNoteImages(root: HTMLElement | null, noteRelativePath?: string): void {
  if (!root) {
    return;
  }

  const images = Array.from(root.querySelectorAll("img"));

  for (const image of images) {
    const originalSrc = image.dataset.trellisImageSrc ?? image.getAttribute("src") ?? "";

    if (!isLocalNoteAssetSrc(originalSrc)) {
      continue;
    }

    image.dataset.trellisImageSrc = originalSrc;

    const cloudPath = tryParseCloudNoteAssetStoragePath(originalSrc);
    if (cloudPath && hasSupabaseConfig()) {
      void getSupabase()
        .storage.from("note-assets")
        .createSignedUrl(cloudPath, NOTE_ASSETS_SIGNED_URL_TTL_SEC)
        .then(({ data, error }) => {
          if (!error && data?.signedUrl && image.isConnected) {
            image.setAttribute("src", data.signedUrl);
          }
        })
        .catch(() => {
          // Leave src unchanged for repair / retry.
        });
      continue;
    }

    if (!noteRelativePath || !hasElectronPreloadBridge()) {
      continue;
    }

    void window.trellis.bucket
      .readNoteAssetDataUrl({
        noteRelativePath,
        assetPath: originalSrc
      })
      .then((dataUrl) => {
        if (dataUrl && image.isConnected) {
          image.setAttribute("src", dataUrl);
        }
      })
      .catch(() => {
        // Missing local images should leave the markdown path intact for repair.
      });
  }
}

export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      const result = reader.result;

      if (typeof result !== "string") {
        reject(new Error("Could not read that image."));
        return;
      }

      const [, base64 = ""] = result.split(",");
      resolve(base64);
    });
    reader.addEventListener("error", () => {
      reject(new Error("Could not read that image."));
    });
    reader.readAsDataURL(file);
  });
}
