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

export function resolveRenderedNoteImages(root: HTMLElement | null, noteRelativePath?: string): void {
  if (!root || !noteRelativePath) {
    return;
  }

  const images = Array.from(root.querySelectorAll("img"));

  for (const image of images) {
    const originalSrc = image.dataset.trellisImageSrc ?? image.getAttribute("src") ?? "";

    if (!isLocalNoteAssetSrc(originalSrc)) {
      continue;
    }

    image.dataset.trellisImageSrc = originalSrc;

    void window.trellis.vault
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
