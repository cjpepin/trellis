import type { SaveNoteInput, StrandRevisionMeta, WikiNote } from "@electron/ipc/types";

/** Max explorer undo steps (file/folder ops in Notes). */
export const WIKI_EXPLORER_UNDO_LIMIT = 50;

/**
 * Parent folders must exist before children; sort by path depth then lexically.
 */
export function sortFolderPathsForRestore(paths: string[]): string[] {
  return [...paths].sort((a, b) => {
    const depth = (p: string) => p.split("/").filter(Boolean).length;
    const delta = depth(a) - depth(b);
    return delta !== 0 ? delta : a.localeCompare(b);
  });
}

export function folderPathToCreateParts(folderPath: string): { name: string; parentPath: string } {
  const lastSlash = folderPath.lastIndexOf("/");
  if (lastSlash === -1) {
    return { name: folderPath, parentPath: "" };
  }
  return {
    name: folderPath.slice(lastSlash + 1),
    parentPath: folderPath.slice(0, lastSlash)
  };
}

export function wikiNoteToSavePayload(
  note: WikiNote,
  folderPath?: string,
  strandRevision?: StrandRevisionMeta
): SaveNoteInput {
  return {
    slug: note.slug,
    relativePath: note.relativePath,
    folderPath: folderPath ?? note.folderPath,
    title: note.title,
    content: note.content,
    frontmatter: {
      tags: note.tags,
      type: note.type,
      sources: note.sources,
      url: note.url
    },
    strandRevision
  };
}

/**
 * When true, Cmd/Ctrl+Z and Shift+Cmd/Ctrl+Z may handle explorer undo/redo instead of the
 * focused control (e.g. skip while typing in the note body or a text field).
 */
export function shouldHandleWikiExplorerUndoRedo(event: KeyboardEvent): boolean {
  if (!event.metaKey && !event.ctrlKey) {
    return false;
  }
  if (event.key.toLowerCase() !== "z") {
    return false;
  }
  if (event.altKey) {
    return false;
  }

  const target = event.target;
  if (!(target instanceof HTMLElement)) {
    return true;
  }
  if (target.closest("[data-wiki-note-editor]")) {
    return false;
  }
  if (target.closest("input, textarea, select")) {
    return false;
  }
  if (target.isContentEditable || target.closest("[contenteditable='true']")) {
    return false;
  }
  return true;
}
