import { BrowserWindow } from "electron";
import { ipcChannels } from "../../ipc/types";
import type { ThoughtUpdatedPayload } from "../../ipc/types";

export function broadcastThoughtUpdated(payload: ThoughtUpdatedPayload): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) {
      window.webContents.send(ipcChannels.thoughtUpdated, payload);
    }
  }
}
