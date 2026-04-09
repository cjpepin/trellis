import type { AppWorkspaceId } from "@electron/ipc/types";

let activeWorkspaceId: AppWorkspaceId = "personal";

export function setActiveWorkspaceId(workspaceId: AppWorkspaceId): void {
  activeWorkspaceId = workspaceId;
}

export function getActiveWorkspaceId(): AppWorkspaceId {
  return activeWorkspaceId;
}

export function getWorkspaceStorageKey(
  key: string,
  storageWorkspaceId: AppWorkspaceId = activeWorkspaceId
): string {
  return `trellis:${storageWorkspaceId}:${key}`;
}

export function readWorkspaceLocalStorage(
  key: string,
  storageWorkspaceId?: AppWorkspaceId
): string | null {
  if (typeof window === "undefined") {
    return null;
  }

  return window.localStorage.getItem(getWorkspaceStorageKey(key, storageWorkspaceId));
}

export function writeWorkspaceLocalStorage(
  key: string,
  value: string,
  storageWorkspaceId?: AppWorkspaceId
): void {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(getWorkspaceStorageKey(key, storageWorkspaceId), value);
}

export function removeWorkspaceLocalStorage(
  key: string,
  storageWorkspaceId?: AppWorkspaceId
): void {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.removeItem(getWorkspaceStorageKey(key, storageWorkspaceId));
}

export function readWorkspaceSessionStorage(
  key: string,
  storageWorkspaceId?: AppWorkspaceId
): string | null {
  if (typeof window === "undefined" || typeof window.sessionStorage === "undefined") {
    return null;
  }

  return window.sessionStorage.getItem(getWorkspaceStorageKey(key, storageWorkspaceId));
}

export function writeWorkspaceSessionStorage(
  key: string,
  value: string,
  storageWorkspaceId?: AppWorkspaceId
): void {
  if (typeof window === "undefined" || typeof window.sessionStorage === "undefined") {
    return;
  }

  window.sessionStorage.setItem(getWorkspaceStorageKey(key, storageWorkspaceId), value);
}

export function removeWorkspaceSessionStorage(
  key: string,
  storageWorkspaceId?: AppWorkspaceId
): void {
  if (typeof window === "undefined" || typeof window.sessionStorage === "undefined") {
    return;
  }

  window.sessionStorage.removeItem(getWorkspaceStorageKey(key, storageWorkspaceId));
}
