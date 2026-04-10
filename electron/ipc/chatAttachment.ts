import fs from "node:fs/promises";
import path from "node:path";
import pdfParse from "pdf-parse";
import { BrowserWindow, dialog, ipcMain } from "electron";
import { ipcChannels } from "./types";

const maxTextChars = 120_000;
const maxPdfBytes = 15 * 1024 * 1024;
const maxTextFileBytes = 2 * 1024 * 1024;

function truncateText(value: string): string {
  if (value.length <= maxTextChars) {
    return value;
  }

  return `${value.slice(0, maxTextChars)}\n\n[…truncated for chat context]`;
}

export function registerChatAttachmentIpc(): void {
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

      if (buf.length > maxPdfBytes) {
        throw new Error("That PDF is too large to attach.");
      }

      const pdf = await pdfParse(Buffer.from(buf));
      return {
        name,
        text: truncateText(pdf.text.trim())
      };
    }

    const buf = await fs.readFile(filePath);

    if (buf.length > maxTextFileBytes) {
      throw new Error("That file is too large to attach.");
    }

    return {
      name,
      text: truncateText(buf.toString("utf8"))
    };
  });
}
