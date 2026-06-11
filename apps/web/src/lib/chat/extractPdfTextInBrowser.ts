import { getDocument, GlobalWorkerOptions } from "pdfjs-dist";
import pdfWorker from "pdfjs-dist/build/pdf.worker.min.mjs?url";

let workerConfigured = false;

function ensurePdfWorker(): void {
  if (workerConfigured) {
    return;
  }
  GlobalWorkerOptions.workerSrc = pdfWorker;
  workerConfigured = true;
}

function textFromContentItem(item: unknown): string {
  if (
    item &&
    typeof item === "object" &&
    "str" in item &&
    typeof (item as { str?: unknown }).str === "string"
  ) {
    return (item as { str: string }).str;
  }
  return "";
}

/**
 * Extract plain text from a PDF in the browser (PDF.js). Used for composer attachments on web.
 */
export async function extractPdfTextInBrowser(data: ArrayBuffer): Promise<string> {
  ensurePdfWorker();
  const copy = new Uint8Array(data.byteLength);
  copy.set(new Uint8Array(data));

  const loadingTask = getDocument({ data: copy });
  const pdf = await loadingTask.promise;

  try {
    const pageTexts: string[] = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const textContent = await page.getTextContent();
      const line: string[] = [];
      for (const item of textContent.items) {
        const s = textFromContentItem(item);
        if (s.length > 0) {
          line.push(s);
        }
      }
      pageTexts.push(line.join(""));
    }
    return pageTexts.join("\n\n").trim();
  } finally {
    await pdf.destroy();
  }
}
