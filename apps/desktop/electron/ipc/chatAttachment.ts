import fs from "node:fs/promises";
import path from "node:path";
import pdfParse from "pdf-parse";
import { BrowserWindow, dialog, ipcMain } from "electron";
import {
  maxChatAttachmentContextChars,
  maxChatPickPdfBytes,
  maxChatPickTextFileBytes
} from "@trellis/shared/chat/attachmentLimits";
import type { AppSettings } from "./types";
import { ipcChannels } from "./types";
import { saveRawSource } from "./bucket";

function truncateText(value: string): string {
  if (value.length <= maxChatAttachmentContextChars) {
    return value;
  }

  return `${value.slice(0, maxChatAttachmentContextChars)}\n\n[…truncated for chat context]`;
}

export function registerChatAttachmentIpc(getSettings: () => AppSettings): void {
  ipcMain.handle(ipcChannels.chatPickAttachment, async (event) => {
    const parentWindow = BrowserWindow.fromWebContents(event.sender);
    const dialogOptions = {
      properties: ["openFile" as const],
      filters: [
        {
          name: "Text and documents",
          extensions: ["txt", "md", "markdown", "json", "csv", "pdf"]
        },
        { name: "All files", extensions: ["*"] }
      ]
    };
    const result = parentWindow
      ? await dialog.showOpenDialog(parentWindow, dialogOptions)
      : await dialog.showOpenDialog(dialogOptions);

    if (result.canceled || !result.filePaths[0]) {
      return null;
    }

    const filePath = result.filePaths[0];
    const name = path.basename(filePath);
    const ext = path.extname(filePath).toLowerCase();

    if (ext === ".pdf") {
      const buf = await fs.readFile(filePath);

      if (buf.length > maxChatPickPdfBytes) {
        throw new Error("That PDF is too large to attach.");
      }

      const settings = getSettings();
      const activeBucket =
        settings.buckets.find((vault) => vault.id === settings.activeBucketId) ?? settings.buckets[0];

      if (!activeBucket) {
        throw new Error("Trellis needs at least one configured vault.");
      }

      const bytes = new Uint8Array(buf);
      const sourcePath = await saveRawSource(activeBucket.path, name, bytes);
      const pdf = await pdfParse(Buffer.from(buf));
      const content = pdf.text.trim();
      const title = name.replace(/\.pdf$/i, "");

      return {
        name,
        text: truncateText(content),
        ingestDraft: {
          title,
          content,
          sourcePath,
          sourceType: "pdf" as const
        }
      };
    }

    const buf = await fs.readFile(filePath);

    if (buf.length > maxChatPickTextFileBytes) {
      throw new Error("That file is too large to attach.");
    }

    return {
      name,
      text: truncateText(buf.toString("utf8"))
    };
  });
}
