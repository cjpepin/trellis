import { useCallback, useEffect, useState } from "react";
import type { AppWorkspaceId } from "@electron/ipc/types";
import { readWorkspaceLocalStorage, writeWorkspaceLocalStorage } from "@/lib/workspace";

const STORAGE_KEY = "noteEditorViewMode";

export type NoteEditorViewMode = "preview" | "markdown";

function parseStored(raw: string | null): NoteEditorViewMode {
  return raw === "markdown" ? "markdown" : "preview";
}

export function usePersistedNoteEditorViewMode(workspaceId: AppWorkspaceId): {
  viewMode: NoteEditorViewMode;
  setViewMode: (mode: NoteEditorViewMode) => void;
} {
  const [viewMode, setViewModeState] = useState<NoteEditorViewMode>(() =>
    parseStored(readWorkspaceLocalStorage(STORAGE_KEY, workspaceId))
  );

  useEffect(() => {
    setViewModeState(parseStored(readWorkspaceLocalStorage(STORAGE_KEY, workspaceId)));
  }, [workspaceId]);

  const setViewMode = useCallback(
    (mode: NoteEditorViewMode) => {
      setViewModeState(mode);
      writeWorkspaceLocalStorage(STORAGE_KEY, mode, workspaceId);
    },
    [workspaceId]
  );

  return { viewMode, setViewMode };
}
