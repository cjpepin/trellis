/** If set, canceling the on-device model download skips the cloud-processing follow-up modal. */
import {
  readWorkspaceLocalStorage,
  removeWorkspaceLocalStorage,
  writeWorkspaceLocalStorage
} from "@/lib/workspace";

const STORAGE_KEY = "local-model-cancel-skip-cloud-prompt";

export function getSkipCloudPromptAfterLocalModelCancel(): boolean {
  return readWorkspaceLocalStorage(STORAGE_KEY) === "1";
}

export function setSkipCloudPromptAfterLocalModelCancel(value: boolean): void {
  if (value) {
    writeWorkspaceLocalStorage(STORAGE_KEY, "1");
  } else {
    removeWorkspaceLocalStorage(STORAGE_KEY);
  }
}
