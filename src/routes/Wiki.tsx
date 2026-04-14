import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  FilePlus2,
  FileText,
  Folder,
  FolderOpen,
  FolderPlus,
  MessageSquare,
  Pencil,
  Trash2,
  X
} from "lucide-react";
import { useNavigate, useSearchParams } from "react-router-dom";
import type {
  AppWorkspaceId,
  FolderSummary,
  SaveNoteInput,
  StrandProvenanceSnapshot,
  VaultSnapshot,
  WikiNote,
  WikiTouchSessionSummary
} from "@electron/ipc/types";
import { NoteViewer } from "@/components/wiki/NoteViewer";
import { cn } from "@/lib/utils";
import { notesRoutePath } from "@/lib/noteRoutes";
import {
  folderPathToCreateParts,
  shouldHandleWikiExplorerUndoRedo,
  sortFolderPathsForRestore,
  wikiNoteToSavePayload,
  WIKI_EXPLORER_UNDO_LIMIT
} from "@/lib/wikiExplorerUndo";
import { readWorkspaceLocalStorage, writeWorkspaceLocalStorage } from "@/lib/workspace";
import { useChatStore } from "@/store/chatStore";
import { useUiStore } from "@/store/uiStore";
import { useWikiStore } from "@/store/wikiStore";

const WIKI_LIST_WIDTH_KEY = "wiki-list-width";
const WIKI_LIST_COLLAPSED_KEY = "wiki-list-collapsed";
const WIKI_EXPANDED_FOLDERS_KEY = "wiki-expanded-folders";
const WIKI_BROWSE_TAB_KEY = "wiki-browse-tab";

type WikiBrowseTab = "recent" | "sessions" | "explorer";
const DEFAULT_WIKI_LIST_WIDTH = 360;
const MIN_WIKI_LIST_WIDTH = 300;
const MAX_WIKI_LIST_WIDTH = 620;

function clampWikiListWidth(value: number): number {
  const max =
    typeof window !== "undefined"
      ? Math.min(MAX_WIKI_LIST_WIDTH, Math.floor(window.innerWidth * 0.58))
      : MAX_WIKI_LIST_WIDTH;
  return Math.min(max, Math.max(MIN_WIKI_LIST_WIDTH, Math.round(value)));
}

function getStoredWikiListWidth(): number {
  const raw = readWorkspaceLocalStorage(WIKI_LIST_WIDTH_KEY);
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? clampWikiListWidth(parsed) : DEFAULT_WIKI_LIST_WIDTH;
}

function getStoredWikiListCollapsed(workspaceId: AppWorkspaceId): boolean {
  return readWorkspaceLocalStorage(WIKI_LIST_COLLAPSED_KEY, workspaceId) === "true";
}

function getStoredWikiBrowseTab(workspaceId: AppWorkspaceId): WikiBrowseTab {
  const raw = readWorkspaceLocalStorage(WIKI_BROWSE_TAB_KEY, workspaceId);
  if (raw === "sessions" || raw === "explorer" || raw === "recent") {
    return raw;
  }
  return "recent";
}

function getStoredExpandedFolders(workspaceId: AppWorkspaceId): Set<string> {
  const raw = readWorkspaceLocalStorage(WIKI_EXPANDED_FOLDERS_KEY, workspaceId);

  if (!raw) {
    return new Set();
  }

  try {
    const parsed = JSON.parse(raw) as unknown;

    if (!Array.isArray(parsed)) {
      return new Set();
    }

    return new Set(parsed.filter((value): value is string => typeof value === "string"));
  } catch {
    return new Set();
  }
}

function humanizeSlug(slug: string): string {
  return slug
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function getParentFolderPath(folderPath: string): string {
  const lastSlash = folderPath.lastIndexOf("/");
  return lastSlash === -1 ? "" : folderPath.slice(0, lastSlash);
}

function getAncestorFolderPaths(folderPath: string): string[] {
  const ancestors: string[] = [];
  let current = folderPath;

  while (current.length > 0) {
    ancestors.unshift(current);
    current = getParentFolderPath(current);
  }

  return ancestors;
}

function getDescendantFolderPaths(folderPath: string, folders: FolderSummary[]): string[] {
  return folders
    .map((folder) => folder.path)
    .filter((path) => path === folderPath || path.startsWith(`${folderPath}/`));
}

function remapFolderPath(path: string, fromPath: string, toPath: string): string {
  return path === fromPath ? toPath : `${toPath}${path.slice(fromPath.length)}`;
}

function formatFolderLabel(folderPath: string): string {
  return folderPath || "Root";
}

function sortFolders(left: FolderSummary, right: FolderSummary): number {
  return left.path.localeCompare(right.path);
}

function sortNotesByTitle<T extends { title: string; updated: string }>(left: T, right: T): number {
  return left.title.localeCompare(right.title) || right.updated.localeCompare(left.updated);
}

/** Hash-router notes shell; used to avoid stealing navigation after async saves when another route is active. */
function isHashNotesRoute(): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  const hash = window.location.hash;
  return hash === "#/notes" || hash.startsWith("#/notes?");
}

type DragPayload =
  | {
      kind: "note";
      slug: string;
      title: string;
      relativePath: string;
      folderPath: string;
    }
  | {
      kind: "folder";
      path: string;
      name: string;
    };

export function Wiki({ workspaceId }: { workspaceId: AppWorkspaceId }) {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const createNameRef = useRef<HTMLInputElement | null>(null);
  const renameFolderRef = useRef<HTMLInputElement | null>(null);
  const listResizeRef = useRef<{ startX: number; startWidth: number } | null>(null);
  const folderDragHoverTimeoutRef = useRef<number | null>(null);
  const explorerUndoStackRef = useRef<Array<{ undo: () => Promise<void>; redo: () => Promise<void> }>>(
    []
  );
  const explorerRedoStackRef = useRef<Array<{ undo: () => Promise<void>; redo: () => Promise<void> }>>(
    []
  );
  const explorerUndoBusyRef = useRef(false);
  const [listWidth, setListWidth] = useState(getStoredWikiListWidth);
  const [listCollapsed, setListCollapsed] = useState(() =>
    getStoredWikiListCollapsed(workspaceId)
  );
  const [isResizingList, setIsResizingList] = useState(false);
  const [query, setQuery] = useState("");
  const [browseTab, setBrowseTab] = useState<WikiBrowseTab>(() => getStoredWikiBrowseTab(workspaceId));
  const [activeVaultId, setActiveVaultId] = useState("");
  const [strandProvenance, setStrandProvenance] = useState<StrandProvenanceSnapshot | null>(null);
  const [touchSessions, setTouchSessions] = useState<WikiTouchSessionSummary[]>([]);
  const [touchSessionsLoading, setTouchSessionsLoading] = useState(false);
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [selectedFolderPath, setSelectedFolderPath] = useState<string | null>(null);
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(() =>
    getStoredExpandedFolders(workspaceId)
  );
  const [dragPayload, setDragPayload] = useState<DragPayload | null>(null);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);
  const [pendingCreate, setPendingCreate] = useState<{
    kind: "note" | "folder";
    parentPath: string;
  } | null>(null);
  const [pendingFolderRenamePath, setPendingFolderRenamePath] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");
  const [isSubmittingCreate, setIsSubmittingCreate] = useState(false);
  const notes = useWikiStore((state) => state.notes);
  const folders = useWikiStore((state) => state.folders);
  const noteCache = useWikiStore((state) => state.noteCache);
  const activeNoteSlug = useWikiStore((state) => state.activeNoteSlug);
  const setActiveNote = useWikiStore((state) => state.setActiveNote);
  const setNote = useWikiStore((state) => state.setNote);
  const replaceIndex = useWikiStore((state) => state.replaceIndex);
  const isHydrated = useWikiStore((state) => state.isHydrated);
  const pushToast = useUiStore((state) => state.pushToast);
  const setActiveChatSession = useChatStore((state) => state.setActiveSession);
  const activeNote = activeNoteSlug ? noteCache[activeNoteSlug] : null;

  const applySnapshot = useCallback(
    (snapshot: VaultSnapshot, preferredSlug?: string | null): void => {
      replaceIndex({
        notes: snapshot.notes,
        folders: snapshot.folders,
        graph: snapshot.graph
      });

      const nextActiveSlug =
        preferredSlug && snapshot.notes.some((note) => note.slug === preferredSlug)
          ? preferredSlug
          : snapshot.notes[0]?.slug ?? null;

      setActiveNote(nextActiveSlug);

      if (nextActiveSlug) {
        navigate(notesRoutePath(nextActiveSlug));
      } else {
        navigate(notesRoutePath());
      }
    },
    [navigate, replaceIndex, setActiveNote]
  );

  useEffect(() => {
    const requestedNote = searchParams.get("note");

    if (!requestedNote || requestedNote === activeNoteSlug) {
      return;
    }

    if (isHydrated && !notes.some((note) => note.slug === requestedNote)) {
      navigate(notesRoutePath(activeNoteSlug), { replace: true });
      return;
    }

    setActiveNote(requestedNote);
  }, [activeNoteSlug, isHydrated, navigate, notes, searchParams, setActiveNote]);

  useEffect(() => {
    if (!activeNoteSlug || activeNote) {
      return;
    }

    const slug = activeNoteSlug;
    const hadSummary = notes.some((note) => note.slug === slug);

    void window.trellis.vault
      .readNote(slug)
      .then(async (note) => {
        setNote(note);
        setSelectedFolderPath(note.folderPath || null);
        setExpandedFolders((current) => {
          if (!note.folderPath) {
            return current;
          }

          const next = new Set(current);
          for (const ancestor of getAncestorFolderPaths(note.folderPath)) {
            next.add(ancestor);
          }
          return next;
        });
        if (!hadSummary) {
          const snapshot = await window.trellis.vault.listIndex();
          applySnapshot(snapshot, slug);
        }
      })
      .catch((error) => {
        pushToast({
          title: error instanceof Error ? error.message : "Could not load that Strand.",
          tone: "warning"
        });
        void window.trellis.vault.listIndex().then((snapshot) => {
          if (!snapshot.notes.some((note) => note.slug === slug)) {
            applySnapshot(snapshot, null);
          }
        });
      });
  }, [activeNote, activeNoteSlug, applySnapshot, notes, pushToast, setNote]);

  useEffect(() => {
    writeWorkspaceLocalStorage(WIKI_LIST_WIDTH_KEY, String(listWidth), workspaceId);
  }, [listWidth, workspaceId]);

  useEffect(() => {
    writeWorkspaceLocalStorage(
      WIKI_LIST_COLLAPSED_KEY,
      listCollapsed ? "true" : "false",
      workspaceId
    );
  }, [listCollapsed, workspaceId]);

  useEffect(() => {
    writeWorkspaceLocalStorage(
      WIKI_EXPANDED_FOLDERS_KEY,
      JSON.stringify([...expandedFolders].sort((left, right) => left.localeCompare(right))),
      workspaceId
    );
  }, [expandedFolders, workspaceId]);

  useEffect(() => {
    setListWidth(getStoredWikiListWidth());
    setListCollapsed(getStoredWikiListCollapsed(workspaceId));
    setBrowseTab(getStoredWikiBrowseTab(workspaceId));
    setSelectedTag(null);
    setSelectedFolderPath(null);
    setPendingCreate(null);
    setPendingFolderRenamePath(null);
    setExpandedFolders(getStoredExpandedFolders(workspaceId));
    explorerUndoStackRef.current = [];
    explorerRedoStackRef.current = [];
  }, [workspaceId]);

  useEffect(() => {
    writeWorkspaceLocalStorage(WIKI_BROWSE_TAB_KEY, browseTab, workspaceId);
  }, [browseTab, workspaceId]);

  useEffect(() => {
    void window.trellis.app.getSettings().then((settings) => {
      setActiveVaultId(settings.activeVaultId);
    });
  }, [workspaceId]);

  useEffect(() => {
    if (!activeNoteSlug || !activeVaultId) {
      setStrandProvenance(null);
      return;
    }

    const fileName = `${activeNoteSlug}.md`;
    let cancelled = false;

    void window.trellis.db
      .getStrandProvenanceForFile({ vaultId: activeVaultId, fileName })
      .then((row) => {
        if (!cancelled) {
          setStrandProvenance(row);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setStrandProvenance(null);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [activeNoteSlug, activeVaultId]);

  useEffect(() => {
    if (browseTab !== "sessions" || !activeVaultId) {
      return;
    }

    let cancelled = false;
    setTouchSessionsLoading(true);

    void window.trellis.db
      .listWikiTouchSessions(activeVaultId)
      .then((rows) => {
        if (!cancelled) {
          setTouchSessions(rows);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setTouchSessions([]);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setTouchSessionsLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [browseTab, activeVaultId]);

  useEffect(() => {
    async function runExplorerUndo(): Promise<void> {
      if (explorerUndoBusyRef.current) {
        return;
      }
      const entry = explorerUndoStackRef.current[0];
      if (!entry) {
        pushToast({
          title: "Nothing to undo for the Strand list.",
          tone: "warning"
        });
        return;
      }
      explorerUndoBusyRef.current = true;
      try {
        await entry.undo();
        explorerUndoStackRef.current = explorerUndoStackRef.current.slice(1);
        explorerRedoStackRef.current = [entry, ...explorerRedoStackRef.current].slice(
          0,
          WIKI_EXPLORER_UNDO_LIMIT
        );
      } catch (error) {
        pushToast({
          title: error instanceof Error ? error.message : "Undo failed.",
          tone: "error"
        });
      } finally {
        explorerUndoBusyRef.current = false;
      }
    }

    async function runExplorerRedo(): Promise<void> {
      if (explorerUndoBusyRef.current) {
        return;
      }
      const entry = explorerRedoStackRef.current[0];
      if (!entry) {
        pushToast({
          title: "Nothing to redo for the Strand list.",
          tone: "warning"
        });
        return;
      }
      explorerUndoBusyRef.current = true;
      try {
        await entry.redo();
        explorerRedoStackRef.current = explorerRedoStackRef.current.slice(1);
        explorerUndoStackRef.current = [entry, ...explorerUndoStackRef.current].slice(
          0,
          WIKI_EXPLORER_UNDO_LIMIT
        );
      } catch (error) {
        pushToast({
          title: error instanceof Error ? error.message : "Redo failed.",
          tone: "error"
        });
      } finally {
        explorerUndoBusyRef.current = false;
      }
    }

    function onExplorerUndoRedoKey(event: KeyboardEvent): void {
      if (!shouldHandleWikiExplorerUndoRedo(event)) {
        return;
      }
      if (event.shiftKey) {
        event.preventDefault();
        void runExplorerRedo();
      } else {
        event.preventDefault();
        void runExplorerUndo();
      }
    }

    window.addEventListener("keydown", onExplorerUndoRedoKey, true);
    return () => {
      window.removeEventListener("keydown", onExplorerUndoRedoKey, true);
    };
  }, [pushToast]);

  useEffect(() => {
    if (!isResizingList) {
      return;
    }

    function handleMouseMove(event: MouseEvent): void {
      const start = listResizeRef.current;
      if (!start) {
        return;
      }
      const dx = event.clientX - start.startX;
      setListWidth(clampWikiListWidth(start.startWidth + dx));
    }

    function handleMouseUp(): void {
      listResizeRef.current = null;
      setIsResizingList(false);
    }

    const previousCursor = document.body.style.cursor;
    const previousUserSelect = document.body.style.userSelect;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);

    return () => {
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousUserSelect;
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isResizingList]);

  useEffect(() => {
    if (!pendingCreate) {
      return;
    }

    queueMicrotask(() => {
      createNameRef.current?.focus();
    });
  }, [pendingCreate]);

  useEffect(() => {
    if (!pendingFolderRenamePath) {
      return;
    }

    queueMicrotask(() => {
      renameFolderRef.current?.focus();
      renameFolderRef.current?.select();
    });
  }, [pendingFolderRenamePath]);

  useEffect(() => {
    if (selectedFolderPath && !folders.some((folder) => folder.path === selectedFolderPath)) {
      setSelectedFolderPath(null);
    }
  }, [folders, selectedFolderPath]);

  useEffect(() => {
    const validFolderPaths = new Set(folders.map((folder) => folder.path));

    setExpandedFolders((current) => {
      const next = new Set<string>();

      for (const path of current) {
        if (validFolderPaths.has(path)) {
          next.add(path);
        }
      }

      return next.size === current.size ? current : next;
    });
  }, [folders]);

  const normalizedQuery = query.trim().toLowerCase();
  const allTags = useMemo(
    () =>
      [...new Set(notes.flatMap((note) => note.tags))]
        .filter((tag) => tag.length > 0)
        .sort((left, right) => left.localeCompare(right)),
    [notes]
  );
  const hasSidebarFilters = Boolean(normalizedQuery || selectedTag);
  const filteredNotes = useMemo(() => {
    return notes
      .filter((note) => {
        if (
          normalizedQuery &&
          !`${note.title} ${note.tags.join(" ")} ${note.folderPath}`.toLowerCase().includes(
            normalizedQuery
          )
        ) {
          return false;
        }

        if (selectedTag && !note.tags.includes(selectedTag)) {
          return false;
        }

        return true;
      })
      .sort(sortNotesByTitle);
  }, [normalizedQuery, notes, selectedTag]);

  const recentNotesOrdered = useMemo(() => {
    return [...filteredNotes].sort(
      (left, right) => right.updated.localeCompare(left.updated) || left.title.localeCompare(right.title)
    );
  }, [filteredNotes]);

  const foldersByParent = useMemo(() => {
    const next = new Map<string, FolderSummary[]>();

    for (const folder of [...folders].sort(sortFolders)) {
      const parentPath = getParentFolderPath(folder.path);
      const existing = next.get(parentPath) ?? [];
      existing.push(folder);
      next.set(parentPath, existing);
    }

    return next;
  }, [folders]);

  const notesByFolder = useMemo(() => {
    const next = new Map<string, typeof filteredNotes>();

    for (const note of filteredNotes) {
      const existing = next.get(note.folderPath) ?? [];
      existing.push(note);
      next.set(note.folderPath, existing);
    }

    for (const list of next.values()) {
      list.sort(sortNotesByTitle);
    }

    return next;
  }, [filteredNotes]);

  const visibleFolderPaths = useMemo(() => {
    if (!hasSidebarFilters) {
      return new Set(folders.map((folder) => folder.path));
    }

    const next = new Set<string>();

    for (const note of filteredNotes) {
      for (const ancestor of getAncestorFolderPaths(note.folderPath)) {
        next.add(ancestor);
      }
    }

    return next;
  }, [filteredNotes, folders, hasSidebarFilters]);

  function beginListResize(clientX: number): void {
    if (listCollapsed) {
      setListCollapsed(false);
      const width = clampWikiListWidth(listWidth);
      setListWidth(width);
      listResizeRef.current = {
        startX: clientX,
        startWidth: width
      };
    } else {
      listResizeRef.current = {
        startX: clientX,
        startWidth: listWidth
      };
    }

    setIsResizingList(true);
  }

  function clearDragState(): void {
    if (folderDragHoverTimeoutRef.current !== null) {
      window.clearTimeout(folderDragHoverTimeoutRef.current);
      folderDragHoverTimeoutRef.current = null;
    }
    setDragPayload(null);
    setDropTargetId(null);
  }

  useEffect(() => {
    return () => {
      if (folderDragHoverTimeoutRef.current !== null) {
        window.clearTimeout(folderDragHoverTimeoutRef.current);
      }
    };
  }, []);

  function pushExplorerUndo(entry: { undo: () => Promise<void>; redo: () => Promise<void> }): void {
    explorerUndoStackRef.current = [entry, ...explorerUndoStackRef.current].slice(
      0,
      WIKI_EXPLORER_UNDO_LIMIT
    );
    explorerRedoStackRef.current = [];
  }

  async function openNote(slug: string): Promise<void> {
    try {
      const summary = notes.find((note) => note.slug === slug);
      setSelectedFolderPath(summary?.folderPath || null);
      setExpandedFolders((current) => {
        if (!summary?.folderPath) {
          return current;
        }

        const next = new Set(current);
        for (const ancestor of getAncestorFolderPaths(summary.folderPath)) {
          next.add(ancestor);
        }
        return next;
      });
      setActiveNote(slug);
      navigate(notesRoutePath(slug));

      if (!noteCache[slug]) {
        const note = await window.trellis.vault.readNote(slug);
        setNote(note);
      }
    } catch (error) {
      pushToast({
        title: error instanceof Error ? error.message : "Could not open that note.",
        tone: "warning"
      });
    }
  }

  function openCreateForm(kind: "note" | "folder"): void {
    setPendingFolderRenamePath(null);
    setPendingCreate({
      kind,
      parentPath: selectedFolderPath ?? activeNote?.folderPath ?? ""
    });
    setDraftName("");
  }

  function closeCreateForm(): void {
    setPendingCreate(null);
    setDraftName("");
  }

  function openRenameFolderForm(folder: FolderSummary): void {
    setPendingCreate(null);
    setPendingFolderRenamePath(folder.path);
    setDraftName(folder.name);
  }

  function closeRenameFolderForm(): void {
    setPendingFolderRenamePath(null);
    setDraftName("");
  }

  async function handleCreate(): Promise<void> {
    if (!pendingCreate) {
      return;
    }

    const value = draftName.trim();

    if (value.length < 1) {
      pushToast({
        title: `Enter a ${pendingCreate.kind === "folder" ? "folder" : "note"} name.`,
        tone: "warning"
      });
      return;
    }

    setIsSubmittingCreate(true);

    try {
      if (pendingCreate.kind === "folder") {
        const parentPath = pendingCreate.parentPath;
        const snapshot = await window.trellis.vault.createFolder({
          name: value,
          parentPath
        });
        applySnapshot(snapshot, activeNoteSlug);
        const createdFolderPath = parentPath ? `${parentPath}/${value}` : value;
        setSelectedFolderPath(createdFolderPath);
        setExpandedFolders((current) => {
          const next = new Set(current);

          for (const ancestor of getAncestorFolderPaths(createdFolderPath)) {
            next.add(ancestor);
          }

          return next;
        });
        pushExplorerUndo({
          undo: async () => {
            const snap = await window.trellis.vault.deleteFolder({ path: createdFolderPath });
            applySnapshot(snap, activeNoteSlug);
            setSelectedFolderPath(parentPath || null);
          },
          redo: async () => {
            const snap = await window.trellis.vault.createFolder({
              name: value,
              parentPath
            });
            applySnapshot(snap, activeNoteSlug);
            setSelectedFolderPath(createdFolderPath);
            setExpandedFolders((current) => {
              const next = new Set(current);
              for (const ancestor of getAncestorFolderPaths(createdFolderPath)) {
                next.add(ancestor);
              }
              return next;
            });
          }
        });
        pushToast({
          title: "Folder created",
          tone: "success"
        });
      } else {
        const parentPath = pendingCreate.parentPath;
        const result = await window.trellis.vault.createStub({
          title: value,
          folderPath: parentPath
        });
        setNote(result.note);
        setSelectedFolderPath(result.note.folderPath || null);
        const snapshot = await window.trellis.vault.listIndex();
        applySnapshot(snapshot, result.note.slug);
        const createdSlug = result.note.slug;
        const createdRelativePath = result.note.relativePath;
        pushExplorerUndo({
          undo: async () => {
            const snap = await window.trellis.vault.deleteNote({
              slug: createdSlug,
              relativePath: createdRelativePath
            });
            applySnapshot(snap, activeNoteSlug);
          },
          redo: async () => {
            const r = await window.trellis.vault.createStub({
              title: value,
              folderPath: parentPath
            });
            setNote(r.note);
            const snap = await window.trellis.vault.listIndex();
            applySnapshot(snap, r.note.slug);
          }
        });
        pushToast({
          title: "Note created",
          tone: "success"
        });
      }

      closeCreateForm();
    } catch (error) {
      pushToast({
        title:
          error instanceof Error
            ? error.message
            : `Could not create that ${pendingCreate.kind}.`,
        tone: "warning"
      });
    } finally {
      setIsSubmittingCreate(false);
    }
  }

  async function handleOpenWikiLink(
    slug: string,
    options?: { linkText?: string }
  ): Promise<void> {
    if (notes.some((note) => note.slug === slug)) {
      await openNote(slug);
      return;
    }

    const title = (options?.linkText?.trim() || humanizeSlug(slug)).slice(0, 120);

    const result = await window.trellis.vault.createStub({
      title,
      folderPath: activeNote?.folderPath ?? ""
    });
    setNote(result.note);
    setSelectedFolderPath(result.note.folderPath || null);
    setExpandedFolders((current) => {
      if (!result.note.folderPath) {
        return current;
      }

      const next = new Set(current);
      for (const ancestor of getAncestorFolderPaths(result.note.folderPath)) {
        next.add(ancestor);
      }
      return next;
    });
    const snapshot = await window.trellis.vault.listIndex();
    applySnapshot(snapshot, result.note.slug);
    const stubSlug = result.note.slug;
    const stubRelativePath = result.note.relativePath;
    const folderPathForStub = activeNote?.folderPath ?? "";
    pushExplorerUndo({
      undo: async () => {
        const snap = await window.trellis.vault.deleteNote({
          slug: stubSlug,
          relativePath: stubRelativePath
        });
        applySnapshot(snap, activeNoteSlug);
      },
      redo: async () => {
        const r = await window.trellis.vault.createStub({
          title,
          folderPath: folderPathForStub
        });
        setNote(r.note);
        const snap = await window.trellis.vault.listIndex();
        applySnapshot(snap, r.note.slug);
      }
    });
    pushToast({
      title: "Stub note created",
      tone: "success",
      noteLinks: [{ label: result.note.title, noteSlug: result.note.slug }]
    });
  }

  async function saveExistingNote(
    note: WikiNote,
    overrides: Partial<Pick<SaveNoteInput, "title" | "content" | "folderPath">> & {
      tags?: string[];
    },
    options?: { recordExplorerMoveUndo?: boolean; skipExplorerUndo?: boolean }
  ): Promise<void> {
    const previousFolderPath = note.folderPath;
    const nextFolderPath =
      overrides.folderPath === undefined ? note.folderPath : overrides.folderPath ?? "";

    const result = await window.trellis.vault.writeNote({
      slug: note.slug,
      relativePath: note.relativePath,
      folderPath: nextFolderPath,
      title: overrides.title ?? note.title,
      content: overrides.content ?? note.content,
      frontmatter: {
        tags: overrides.tags ?? note.tags,
        type: note.type,
        sources: note.sources,
        url: note.url
      }
    });

    setNote(result.note);
    setSelectedFolderPath(result.note.folderPath || null);
    setExpandedFolders((current) => {
      if (!result.note.folderPath) {
        return current;
      }

      const next = new Set(current);
      for (const ancestor of getAncestorFolderPaths(result.note.folderPath)) {
        next.add(ancestor);
      }
      return next;
    });
    const snapshot = await window.trellis.vault.listIndex();
    replaceIndex({
      notes: snapshot.notes,
      folders: snapshot.folders,
      graph: snapshot.graph
    });

    if (result.note.slug !== note.slug) {
      setActiveNote(result.note.slug);
      if (isHashNotesRoute()) {
        navigate(notesRoutePath(result.note.slug), { replace: true });
      }
    }

    if (
      !options?.skipExplorerUndo &&
      options?.recordExplorerMoveUndo &&
      overrides.folderPath !== undefined &&
      previousFolderPath !== nextFolderPath
    ) {
      const slug = note.slug;
      pushExplorerUndo({
        undo: async () => {
          const current = useWikiStore.getState().noteCache[slug];
          if (!current) {
            return;
          }
          await saveExistingNote(
            current,
            { folderPath: previousFolderPath },
            { skipExplorerUndo: true }
          );
        },
        redo: async () => {
          const current = useWikiStore.getState().noteCache[slug];
          if (!current) {
            return;
          }
          await saveExistingNote(current, { folderPath: nextFolderPath }, { skipExplorerUndo: true });
        }
      });
    }
  }

  async function handleSaveTitle(title: string, slug: string): Promise<void> {
    const note = useWikiStore.getState().noteCache[slug];

    if (!note) {
      return;
    }

    const trimmed = title.trim();

    if (trimmed.length < 1) {
      pushToast({
        title: "Title cannot be empty.",
        tone: "warning"
      });
      return;
    }

    if (trimmed.length > 120) {
      pushToast({
        title: "Title must be 120 characters or fewer.",
        tone: "warning"
      });
      return;
    }

    if (trimmed === note.title) {
      return;
    }

    try {
      await saveExistingNote(note, { title: trimmed });
    } catch (error) {
      pushToast({
        title: error instanceof Error ? error.message : "Could not save that title.",
        tone: "error"
      });
    }
  }

  async function handleSave(content: string, slug: string): Promise<void> {
    const note = useWikiStore.getState().noteCache[slug];

    if (!note) {
      return;
    }

    try {
      await saveExistingNote(note, { content });
    } catch (error) {
      pushToast({
        title: error instanceof Error ? error.message : "Could not save that note.",
        tone: "error"
      });
    }
  }

  async function handleAddTag(tag: string): Promise<void> {
    if (!activeNote) {
      return;
    }

    const normalizedTag = tag.trim().toLowerCase();

    if (!normalizedTag || activeNote.tags.includes(normalizedTag)) {
      return;
    }

    try {
      await saveExistingNote(activeNote, {
        tags: [...activeNote.tags, normalizedTag].sort((left, right) => left.localeCompare(right))
      });
    } catch (error) {
      pushToast({
        title: error instanceof Error ? error.message : "Could not update tags.",
        tone: "error"
      });
    }
  }

  async function handleRemoveTag(tag: string): Promise<void> {
    if (!activeNote) {
      return;
    }

    try {
      await saveExistingNote(activeNote, {
          tags: activeNote.tags.filter((value) => value !== tag)
      });

      if (selectedTag === tag) {
        setSelectedTag(null);
      }
    } catch (error) {
      pushToast({
        title: error instanceof Error ? error.message : "Could not update tags.",
        tone: "error"
      });
    }
  }

  async function handleMoveToFolder(folderPath: string): Promise<void> {
    if (!activeNote) {
      return;
    }

    try {
      await saveExistingNote(
        activeNote,
        {
          folderPath
        },
        { recordExplorerMoveUndo: true }
      );
    } catch (error) {
      pushToast({
        title: error instanceof Error ? error.message : "Could not move that note.",
        tone: "error"
      });
    }
  }

  async function handleDeleteNoteBySummary(note: {
    slug: string;
    title: string;
    relativePath: string;
    folderPath: string;
  }): Promise<void> {
    if (
      !window.confirm(`Delete "${note.title}"? This removes the Strand from your vault.`)
    ) {
      return;
    }

    try {
      const cached = useWikiStore.getState().noteCache[note.slug];
      const fullBody = cached ?? (await window.trellis.vault.readNote(note.slug));
      const deleteInput = { slug: note.slug, relativePath: note.relativePath };
      const preferredAfterDelete = activeNoteSlug === note.slug ? null : activeNoteSlug;
      const snapshot = await window.trellis.vault.deleteNote(deleteInput);
      setSelectedFolderPath(note.folderPath || null);
      applySnapshot(snapshot, preferredAfterDelete);
      pushExplorerUndo({
        undo: async () => {
          await window.trellis.vault.writeNote(wikiNoteToSavePayload(fullBody));
          const snap = await window.trellis.vault.listIndex();
          applySnapshot(snap, fullBody.slug);
        },
        redo: async () => {
          const snap = await window.trellis.vault.deleteNote(deleteInput);
          applySnapshot(snap, preferredAfterDelete);
        }
      });
      pushToast({
        title: "Strand deleted",
        tone: "success"
      });
    } catch (error) {
      pushToast({
        title: error instanceof Error ? error.message : "Could not delete that note.",
        tone: "error"
      });
    }
  }

  async function handleDeleteNote(): Promise<void> {
    if (!activeNote) {
      return;
    }

    await handleDeleteNoteBySummary({
      slug: activeNote.slug,
      title: activeNote.title,
      relativePath: activeNote.relativePath,
      folderPath: activeNote.folderPath
    });
  }

  async function moveDraggedItemToFolder(
    payload: DragPayload,
    nextFolderPath: string
  ): Promise<void> {
    if (payload.kind === "note") {
      if (payload.folderPath === nextFolderPath) {
        return;
      }

      const note = useWikiStore.getState().noteCache[payload.slug];
      const summary = notes.find((item) => item.slug === payload.slug);

      if (!summary) {
        return;
      }

      if (note) {
        await saveExistingNote(
          note,
          { folderPath: nextFolderPath },
          { recordExplorerMoveUndo: true }
        );
        return;
      }

      const fullNote = await window.trellis.vault.readNote(payload.slug);
      setNote(fullNote);
      await saveExistingNote(
        fullNote,
        { folderPath: nextFolderPath },
        { recordExplorerMoveUndo: true }
      );
      return;
    }

    if (payload.path === nextFolderPath || getParentFolderPath(payload.path) === nextFolderPath) {
      return;
    }

    if (nextFolderPath.startsWith(`${payload.path}/`)) {
      pushToast({
        title: "A folder cannot be moved inside itself.",
        tone: "warning"
      });
      return;
    }

    const snapshot = await window.trellis.vault.renameFolder({
      path: payload.path,
      name: payload.name,
      parentPath: nextFolderPath
    });
    applySnapshot(snapshot, activeNoteSlug);
    const movedPath = [nextFolderPath, payload.name].filter(Boolean).join("/");
    setSelectedFolderPath((current) => {
      if (!current) {
        return current;
      }

      if (current === payload.path) {
        return movedPath;
      }

      return current.startsWith(`${payload.path}/`)
        ? remapFolderPath(current, payload.path, movedPath)
        : current;
    });
    setExpandedFolders((current) => {
      const descendants = getDescendantFolderPaths(payload.path, folders);
      const next = new Set(current);
      let changed = false;

      for (const path of descendants) {
        if (!next.has(path)) {
          continue;
        }

        next.delete(path);
        next.add(remapFolderPath(path, payload.path, movedPath));
        changed = true;
      }

      return changed ? next : current;
    });
    const fromPath = payload.path;
    const folderSegment = payload.name;
    const targetParent = nextFolderPath;
    pushExplorerUndo({
      undo: async () => {
        const snap = await window.trellis.vault.renameFolder({
          path: movedPath,
          name: folderSegment,
          parentPath: getParentFolderPath(fromPath)
        });
        applySnapshot(snap, activeNoteSlug);
        const liveFolders = useWikiStore.getState().folders;
        setSelectedFolderPath((current) => {
          if (!current) {
            return current;
          }
          if (current === movedPath) {
            return fromPath;
          }
          return current.startsWith(`${movedPath}/`)
            ? remapFolderPath(current, movedPath, fromPath)
            : current;
        });
        setExpandedFolders((current) => {
          const descendants = getDescendantFolderPaths(movedPath, liveFolders);
          const next = new Set(current);
          let changed = false;
          for (const path of descendants) {
            if (!next.has(path)) {
              continue;
            }
            next.delete(path);
            next.add(remapFolderPath(path, movedPath, fromPath));
            changed = true;
          }
          return changed ? next : current;
        });
      },
      redo: async () => {
        const snap = await window.trellis.vault.renameFolder({
          path: fromPath,
          name: folderSegment,
          parentPath: targetParent
        });
        applySnapshot(snap, activeNoteSlug);
        const liveFolders = useWikiStore.getState().folders;
        setSelectedFolderPath((current) => {
          if (!current) {
            return current;
          }
          if (current === fromPath) {
            return movedPath;
          }
          return current.startsWith(`${fromPath}/`)
            ? remapFolderPath(current, fromPath, movedPath)
            : current;
        });
        setExpandedFolders((current) => {
          const descendants = getDescendantFolderPaths(fromPath, liveFolders);
          const next = new Set(current);
          let changed = false;
          for (const path of descendants) {
            if (!next.has(path)) {
              continue;
            }
            next.delete(path);
            next.add(remapFolderPath(path, fromPath, movedPath));
            changed = true;
          }
          return changed ? next : current;
        });
      }
    });
  }

  function canDropOnFolder(folderPath: string): boolean {
    if (!dragPayload) {
      return false;
    }

    if (dragPayload.kind === "note") {
      return dragPayload.folderPath !== folderPath;
    }

    return (
      dragPayload.path !== folderPath &&
      getParentFolderPath(dragPayload.path) !== folderPath &&
      !folderPath.startsWith(`${dragPayload.path}/`)
    );
  }

  function canDropOnRoot(): boolean {
    if (!dragPayload) {
      return false;
    }

    if (dragPayload.kind === "note") {
      return dragPayload.folderPath !== "";
    }

    return getParentFolderPath(dragPayload.path) !== "";
  }

  async function handleRenameFolder(folder: FolderSummary, nextName: string): Promise<void> {
    const trimmed = nextName.trim();

    if (!trimmed || trimmed === folder.name) {
      closeRenameFolderForm();
      return;
    }

    try {
      const oldPath = folder.path;
      const oldName = folder.name;
      const parentPath = getParentFolderPath(folder.path);
      const nextPath = [parentPath, trimmed].filter(Boolean).join("/");
      const snapshot = await window.trellis.vault.renameFolder({
        path: folder.path,
        name: trimmed,
        parentPath
      });
      applySnapshot(snapshot, activeNoteSlug);
      setSelectedFolderPath((current) => {
        if (!current) {
          return current;
        }

        if (current === folder.path) {
          return nextPath;
        }

        return current.startsWith(`${folder.path}/`)
          ? remapFolderPath(current, folder.path, nextPath)
          : current;
      });
      setExpandedFolders((current) => {
        const descendants = getDescendantFolderPaths(folder.path, folders);
        const next = new Set(current);
        let changed = false;

        for (const path of descendants) {
          if (!next.has(path)) {
            continue;
          }

          next.delete(path);
          next.add(remapFolderPath(path, folder.path, nextPath));
          changed = true;
        }

        return changed ? next : current;
      });
      pushExplorerUndo({
        undo: async () => {
          const snap = await window.trellis.vault.renameFolder({
            path: nextPath,
            name: oldName,
            parentPath
          });
          applySnapshot(snap, activeNoteSlug);
          const liveFolders = useWikiStore.getState().folders;
          setSelectedFolderPath((current) => {
            if (!current) {
              return current;
            }
            if (current === nextPath) {
              return oldPath;
            }
            return current.startsWith(`${nextPath}/`)
              ? remapFolderPath(current, nextPath, oldPath)
              : current;
          });
          setExpandedFolders((current) => {
            const descendants = getDescendantFolderPaths(nextPath, liveFolders);
            const next = new Set(current);
            let changed = false;
            for (const path of descendants) {
              if (!next.has(path)) {
                continue;
              }
              next.delete(path);
              next.add(remapFolderPath(path, nextPath, oldPath));
              changed = true;
            }
            return changed ? next : current;
          });
        },
        redo: async () => {
          const snap = await window.trellis.vault.renameFolder({
            path: oldPath,
            name: trimmed,
            parentPath
          });
          applySnapshot(snap, activeNoteSlug);
          const liveFolders = useWikiStore.getState().folders;
          setSelectedFolderPath((current) => {
            if (!current) {
              return current;
            }
            if (current === oldPath) {
              return nextPath;
            }
            return current.startsWith(`${oldPath}/`)
              ? remapFolderPath(current, oldPath, nextPath)
              : current;
          });
          setExpandedFolders((current) => {
            const descendants = getDescendantFolderPaths(oldPath, liveFolders);
            const next = new Set(current);
            let changed = false;
            for (const path of descendants) {
              if (!next.has(path)) {
                continue;
              }
              next.delete(path);
              next.add(remapFolderPath(path, oldPath, nextPath));
              changed = true;
            }
            return changed ? next : current;
          });
        }
      });
      closeRenameFolderForm();
      pushToast({
        title: "Folder renamed",
        tone: "success"
      });
    } catch (error) {
      pushToast({
        title: error instanceof Error ? error.message : "Could not rename that folder.",
        tone: "error"
      });
    }
  }

  async function handleDeleteFolder(folder: FolderSummary): Promise<void> {
    if (
      !window.confirm(
        `Delete folder "${folder.path}" and everything inside it? This removes nested notes too.`
      )
    ) {
      return;
    }

    try {
      const rootPath = folder.path;
      const subtreeFolders = sortFolderPathsForRestore(
        folders
          .map((f) => f.path)
          .filter((p) => p === rootPath || p.startsWith(`${rootPath}/`))
      );
      const affectedSummaries = notes.filter(
        (n) => n.folderPath === rootPath || n.folderPath.startsWith(`${rootPath}/`)
      );
      const wikiBodies = await Promise.all(
        affectedSummaries.map((summary) => window.trellis.vault.readNote(summary.slug))
      );
      const snapshot = await window.trellis.vault.deleteFolder({
        path: folder.path
      });
      applySnapshot(snapshot, activeNoteSlug);
      setSelectedFolderPath(null);
      pushExplorerUndo({
        undo: async () => {
          for (const fp of subtreeFolders) {
            const { name, parentPath } = folderPathToCreateParts(fp);
            await window.trellis.vault.createFolder({
              name,
              parentPath: parentPath || undefined
            });
          }
          for (const body of wikiBodies) {
            await window.trellis.vault.writeNote(wikiNoteToSavePayload(body));
          }
          const snap = await window.trellis.vault.listIndex();
          applySnapshot(snap, wikiBodies[0]?.slug ?? activeNoteSlug);
        },
        redo: async () => {
          const snap = await window.trellis.vault.deleteFolder({ path: rootPath });
          applySnapshot(snap, activeNoteSlug);
          setSelectedFolderPath(null);
        }
      });
      pushToast({
        title: "Folder deleted",
        tone: "success"
      });
    } catch (error) {
      pushToast({
        title: error instanceof Error ? error.message : "Could not delete that folder.",
        tone: "error"
      });
    }
  }

  function toggleFolderExpanded(folderPath: string): void {
    setExpandedFolders((current) => {
      const next = new Set(current);

      if (next.has(folderPath)) {
        next.delete(folderPath);
      } else {
        next.add(folderPath);
      }

      return next;
    });
  }

  function scheduleFolderAutoExpand(folderPath: string, isCollapsed: boolean): void {
    if (!isCollapsed) {
      if (folderDragHoverTimeoutRef.current !== null) {
        window.clearTimeout(folderDragHoverTimeoutRef.current);
        folderDragHoverTimeoutRef.current = null;
      }
      return;
    }

    if (folderDragHoverTimeoutRef.current !== null) {
      window.clearTimeout(folderDragHoverTimeoutRef.current);
    }

    folderDragHoverTimeoutRef.current = window.setTimeout(() => {
      setExpandedFolders((current) => {
        if (current.has(folderPath)) {
          return current;
        }

        const next = new Set(current);
        next.add(folderPath);
        return next;
      });
      folderDragHoverTimeoutRef.current = null;
    }, 220);
  }

  function cancelFolderAutoExpand(): void {
    if (folderDragHoverTimeoutRef.current !== null) {
      window.clearTimeout(folderDragHoverTimeoutRef.current);
      folderDragHoverTimeoutRef.current = null;
    }
  }

  function renderNoteRow(note: (typeof filteredNotes)[number], depth: number) {
    const isDropTarget = dropTargetId === `note:${note.slug}`;
    const titleClassName =
      depth >= 2 ? "text-[12px] text-trellis-muted" : depth === 1 ? "text-[13px] text-trellis-text/90" : "text-[13px] text-trellis-text";

    return (
      <div
        key={note.slug}
        className={`group flex items-center gap-1 rounded-field border transition-all duration-150 ${
          activeNoteSlug === note.slug
            ? "trellis-selected-surface border-trellis-accent/25"
            : "border-transparent hover:border-trellis-border hover:bg-trellis-surface-2"
        } ${isDropTarget ? "border-trellis-accent/40 bg-trellis-surface-2" : ""}`}
      >
        <button
          type="button"
          className="min-w-0 flex-1 px-2.5 py-1.5 text-left"
          style={{ paddingLeft: `${10 + depth * 18}px` }}
          draggable
          onDragStart={(event) => {
            const payload: DragPayload = {
              kind: "note",
              slug: note.slug,
              title: note.title,
              relativePath: note.relativePath,
              folderPath: note.folderPath
            };
            setDragPayload(payload);
            event.dataTransfer.effectAllowed = "move";
            event.dataTransfer.setData("text/plain", note.slug);
          }}
          onDragEnd={() => {
            clearDragState();
          }}
          onClick={() => {
            void openNote(note.slug);
          }}
        >
          <span className="flex min-w-0 items-center gap-2">
            <span
              aria-hidden
              className={`h-px shrink-0 rounded-full bg-trellis-border ${
                depth > 0 ? "w-3 opacity-90" : "w-2 opacity-55"
              }`}
            />
            <span className={`truncate font-medium ${titleClassName}`}>{note.title}</span>
          </span>
        </button>
        <button
          type="button"
          className="mr-1 rounded-field border border-transparent p-1 text-trellis-faint opacity-0 transition hover:border-red-400/30 hover:text-red-200 group-hover:opacity-100"
          title="Delete Strand"
          aria-label={`Delete ${note.title}`}
          onClick={(event) => {
            event.stopPropagation();
            void handleDeleteNoteBySummary(note);
          }}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
    );
  }

  function renderFolderRow(folder: FolderSummary, depth: number) {
    const childFolders = (foldersByParent.get(folder.path) ?? []).filter(
      (child) => !hasSidebarFilters || visibleFolderPaths.has(child.path)
    );
    const childNotes = notesByFolder.get(folder.path) ?? [];

    if (
      hasSidebarFilters &&
      childFolders.length === 0 &&
      childNotes.length === 0 &&
      selectedFolderPath !== folder.path
    ) {
      return null;
    }

    const isCollapsed = !expandedFolders.has(folder.path);
    const isDropTarget = dropTargetId === `folder:${folder.path}`;
    const isRenaming = pendingFolderRenamePath === folder.path;
    const folderRowClassName =
      "flex min-w-0 flex-1 items-center gap-2 rounded-field border border-transparent px-2.5 py-1.5 text-left transition hover:border-trellis-border hover:bg-trellis-surface-2";
    const folderRowPadding = { paddingLeft: `${10 + depth * 18}px` };

    return (
      <div key={folder.path} className="space-y-1 transition-all duration-200">
        <div
          data-testid={`wiki-folder-row-${folder.path}`}
          className={`group flex items-center gap-1 rounded-field transition-all duration-150 ${
            isDropTarget ? "bg-trellis-surface-2/70 ring-1 ring-inset ring-trellis-accent/35" : ""
          }`}
          onDragOver={(event) => {
            if (!canDropOnFolder(folder.path)) {
              return;
            }
            event.preventDefault();
            event.dataTransfer.dropEffect = "move";
            scheduleFolderAutoExpand(folder.path, isCollapsed);
            if (dropTargetId !== `folder:${folder.path}`) {
              setDropTargetId(`folder:${folder.path}`);
            }
          }}
          onDragLeave={() => {
            cancelFolderAutoExpand();
            if (dropTargetId === `folder:${folder.path}`) {
              setDropTargetId(null);
            }
          }}
          onDrop={(event) => {
            if (!dragPayload || !canDropOnFolder(folder.path)) {
              return;
            }

            event.preventDefault();
            cancelFolderAutoExpand();
            const payload = dragPayload;
            clearDragState();
            void moveDraggedItemToFolder(payload, folder.path).catch((error) => {
              pushToast({
                title: error instanceof Error ? error.message : "Could not move that item.",
                tone: "error"
              });
            });
          }}
        >
          <button
            type="button"
            className="rounded-field p-1 text-trellis-faint transition hover:text-trellis-text"
            aria-label={isCollapsed ? `Expand ${folder.name}` : `Collapse ${folder.name}`}
            onDragStart={(event) => {
              event.preventDefault();
            }}
            onClick={() => toggleFolderExpanded(folder.path)}
          >
            {isCollapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          </button>
          {isRenaming ? (
            <div className={folderRowClassName} style={folderRowPadding}>
              {isCollapsed ? (
                <Folder className="h-4 w-4 shrink-0 text-trellis-faint" />
              ) : (
                <FolderOpen className="h-4 w-4 shrink-0 text-trellis-accent/80" />
              )}
              <div className="flex min-w-0 flex-1 items-center gap-1">
                <input
                  ref={renameFolderRef}
                  value={draftName}
                  onChange={(event) => setDraftName(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      void handleRenameFolder(folder, draftName);
                    }

                    if (event.key === "Escape") {
                      event.preventDefault();
                      closeRenameFolderForm();
                    }
                  }}
                  className="min-w-0 flex-1 bg-transparent text-[13px] font-medium text-trellis-text outline-none placeholder:text-trellis-faint"
                  aria-label="Rename folder"
                />
                <button
                  type="button"
                  className="rounded-field border border-transparent p-1 text-trellis-faint transition hover:border-trellis-border hover:text-trellis-text"
                  aria-label="Save folder name"
                  title="Save folder name"
                  onClick={() => {
                    void handleRenameFolder(folder, draftName);
                  }}
                >
                  <Check className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  className="rounded-field border border-transparent p-1 text-trellis-faint transition hover:border-trellis-border hover:text-trellis-text"
                  aria-label="Cancel rename"
                  title="Cancel rename"
                  onClick={() => {
                    closeRenameFolderForm();
                  }}
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              className={folderRowClassName}
              style={folderRowPadding}
              draggable
              onDragStart={(event) => {
                const payload: DragPayload = {
                  kind: "folder",
                  path: folder.path,
                  name: folder.name
                };
                setDragPayload(payload);
                event.dataTransfer.effectAllowed = "move";
                event.dataTransfer.setData("text/plain", folder.path);
              }}
              onDragEnd={() => {
                clearDragState();
              }}
              onClick={() => {
                toggleFolderExpanded(folder.path);
              }}
            >
              {isCollapsed ? (
                <Folder className="h-4 w-4 shrink-0 text-trellis-faint" />
              ) : (
                <FolderOpen className="h-4 w-4 shrink-0 text-trellis-accent/80" />
              )}
              <>
                <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-trellis-text">
                  {folder.name}
                </span>
                <span className="text-[11px] text-trellis-faint">{folder.noteCount}</span>
              </>
            </button>
          )}
          <div className="flex items-center gap-1 opacity-0 transition group-hover:opacity-100">
            <button
              type="button"
              className="rounded-field border border-transparent p-1 text-trellis-faint transition hover:border-trellis-border hover:text-trellis-text"
              title="Rename folder"
              data-testid={`wiki-folder-rename-${folder.path}`}
              onClick={(event) => {
                event.stopPropagation();
                openRenameFolderForm(folder);
              }}
            >
              <Pencil className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              className="rounded-field border border-transparent p-1 text-trellis-faint transition hover:border-red-400/30 hover:text-red-200"
              title="Delete folder"
              onClick={(event) => {
                event.stopPropagation();
                void handleDeleteFolder(folder);
              }}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
        <div
          className={`grid transition-[grid-template-rows,opacity] duration-200 ease-out ${
            isCollapsed ? "grid-rows-[0fr] opacity-70" : "grid-rows-[1fr] opacity-100"
          }`}
        >
          <div className="min-h-0 overflow-hidden">
            <div className="space-y-1 pt-1">
              <div
                className={`overflow-hidden transition-[max-height,opacity,transform] duration-150 ease-out ${
                  isDropTarget ? "max-h-10 translate-y-0 opacity-100" : "max-h-0 -translate-y-1 opacity-0"
                }`}
                aria-hidden={!isDropTarget}
              >
                <div className="ml-7 rounded-field border border-dashed border-trellis-accent/35 bg-trellis-accent/8 px-2.5 py-1.5 text-[11px] uppercase tracking-[0.14em] text-trellis-accent">
                  Drop into {folder.name}
                </div>
              </div>
              {childFolders.map((childFolder) => renderFolderRow(childFolder, depth + 1))}
              {childNotes.map((note) => renderNoteRow(note, depth + 1))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  const rootFolders = (foldersByParent.get("") ?? []).filter(
    (folder) => !hasSidebarFilters || visibleFolderPaths.has(folder.path)
  );
  const rootNotes = notesByFolder.get("") ?? [];
  const isRootDropTarget = dropTargetId === "folder:root";

  const wikiListOpenWidth = listCollapsed ? 0 : listWidth;

  return (
    <div className="flex h-full min-h-0 w-full flex-1 gap-0 p-6" data-testid="route-notes">
      <div
        className={cn(
          "shrink-0 overflow-hidden transition-[width,opacity] duration-300 ease-out motion-reduce:transition-none motion-reduce:duration-0",
          listCollapsed ? "pointer-events-none min-w-0 opacity-0" : "opacity-100"
        )}
        style={{ width: wikiListOpenWidth }}
        aria-hidden={listCollapsed}
      >
        <section
          className="trellis-panel flex h-full min-h-0 flex-col overflow-hidden"
          style={{ width: listWidth }}
        >
            <div className="border-b border-trellis-border px-4 py-4">
              <div className="flex items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-1">
                  <button
                    type="button"
                    className="shrink-0 rounded-field border border-transparent p-1.5 text-trellis-muted transition hover:border-trellis-border hover:text-trellis-text"
                    aria-label="Hide Strand list"
                    title="Hide Strand list"
                    onClick={() => {
                      setListCollapsed(true);
                    }}
                  >
                    <ChevronLeft className="h-4 w-4" aria-hidden />
                  </button>
                  <p className="font-display text-2xl text-trellis-text">Strands</p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    className="rounded-field border border-trellis-border p-2 text-trellis-muted transition hover:border-trellis-accent/30 hover:text-trellis-text"
                    title="New folder"
                    aria-label="New folder"
                    onClick={() => openCreateForm("folder")}
                  >
                    <FolderPlus className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    className="rounded-field border border-trellis-border p-2 text-trellis-muted transition hover:border-trellis-accent/30 hover:text-trellis-text"
                    title="New Strand"
                    aria-label="New Strand"
                    onClick={() => openCreateForm("note")}
                  >
                    <FilePlus2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  className={`rounded-field border px-2.5 py-1 text-xs transition ${
                    browseTab === "recent"
                      ? "border-trellis-accent/40 bg-trellis-accent/10 text-trellis-text"
                      : "border-trellis-border text-trellis-muted hover:border-trellis-accent/25"
                  }`}
                  onClick={() => setBrowseTab("recent")}
                >
                  Recent
                </button>
                <button
                  type="button"
                  className={`rounded-field border px-2.5 py-1 text-xs transition ${
                    browseTab === "sessions"
                      ? "border-trellis-accent/40 bg-trellis-accent/10 text-trellis-text"
                      : "border-trellis-border text-trellis-muted hover:border-trellis-accent/25"
                  }`}
                  onClick={() => setBrowseTab("sessions")}
                >
                  From chats
                </button>
                <button
                  type="button"
                  className={`rounded-field border px-2.5 py-1 text-xs transition ${
                    browseTab === "explorer"
                      ? "border-trellis-accent/40 bg-trellis-accent/10 text-trellis-text"
                      : "border-trellis-border text-trellis-muted hover:border-trellis-accent/25"
                  }`}
                  onClick={() => setBrowseTab("explorer")}
                >
                  Explorer
                </button>
              </div>
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                className="trellis-input mt-4"
                placeholder="Search titles, tags, and folders…"
              />
              {selectedTag && (
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    className="inline-flex items-center gap-2 rounded-full border border-trellis-accent/25 bg-trellis-surface-2 px-3 py-1 text-xs text-trellis-text"
                    onClick={() => setSelectedTag(null)}
                  >
                    tag: {selectedTag}
                    <X className="h-3 w-3" />
                  </button>
                </div>
              )}
            </div>
            <div
              className={`trellis-scrollbar min-h-0 flex-1 overflow-y-auto p-3 ${
                isRootDropTarget ? "bg-trellis-surface-2/45" : ""
              }`}
              onDragOver={(event) => {
                if (!canDropOnRoot()) {
                  return;
                }
                event.preventDefault();
                event.dataTransfer.dropEffect = "move";
                if (dropTargetId !== "folder:root") {
                  setDropTargetId("folder:root");
                }
              }}
              onDragLeave={(event) => {
                if (event.currentTarget.contains(event.relatedTarget as Node | null)) {
                  return;
                }

                if (dropTargetId === "folder:root") {
                  setDropTargetId(null);
                }
              }}
              onDrop={(event) => {
                if (!dragPayload || !canDropOnRoot()) {
                  return;
                }

                event.preventDefault();
                const payload = dragPayload;
                clearDragState();
                void moveDraggedItemToFolder(payload, "").catch((error) => {
                  pushToast({
                    title: error instanceof Error ? error.message : "Could not move that item.",
                    tone: "error"
                  });
                });
              }}
            >
              <div className="space-y-1">
                <div
                  className={`overflow-hidden transition-[max-height,opacity,transform] duration-150 ease-out ${
                    isRootDropTarget ? "max-h-10 translate-y-0 opacity-100" : "max-h-0 -translate-y-1 opacity-0"
                  }`}
                  aria-hidden={!isRootDropTarget}
                >
                  <div className="rounded-field border border-dashed border-trellis-accent/35 bg-trellis-accent/8 px-2.5 py-1.5 text-[11px] uppercase tracking-[0.14em] text-trellis-accent">
                    Drop into root
                  </div>
                </div>
                {pendingCreate ? (
                  <div className="rounded-field border border-trellis-accent/25 bg-trellis-surface-2/70">
                    <div className="flex items-center gap-1">
                      <span className="flex items-center px-2.5 text-trellis-faint">
                        {pendingCreate.kind === "folder" ? (
                          <Folder className="h-4 w-4" />
                        ) : (
                          <FileText className="h-4 w-4" />
                        )}
                      </span>
                      <div className="flex min-w-0 flex-1 items-center py-1.5 pr-1.5">
                        <input
                          ref={createNameRef}
                          value={draftName}
                          onChange={(event) => setDraftName(event.target.value)}
                          onKeyDown={(event) => {
                            if (event.key === "Enter") {
                              event.preventDefault();
                              void handleCreate();
                            }
                            if (event.key === "Escape") {
                              closeCreateForm();
                            }
                          }}
                          className="min-w-0 flex-1 bg-transparent px-1.5 text-[13px] font-medium text-trellis-text outline-none placeholder:text-trellis-faint"
                          placeholder={
                            pendingCreate.kind === "folder"
                              ? `New folder in ${formatFolderLabel(pendingCreate.parentPath)}`
                              : `New note in ${formatFolderLabel(pendingCreate.parentPath)}`
                          }
                          disabled={isSubmittingCreate}
                          aria-label={pendingCreate.kind === "folder" ? "Folder name" : "Note title"}
                        />
                        <button
                          type="button"
                          className="rounded-field border border-transparent p-1 text-trellis-faint transition hover:border-trellis-border hover:text-trellis-text"
                          aria-label="Cancel create"
                          title="Cancel"
                          disabled={isSubmittingCreate}
                          onClick={closeCreateForm}
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </div>
                    </div>
                  </div>
                ) : null}
                {browseTab === "explorer" ? (
                  <>
                    {rootFolders.map((folder) => renderFolderRow(folder, 0))}
                    {rootNotes.map((note) => renderNoteRow(note, 0))}
                  </>
                ) : null}
                {browseTab === "recent"
                  ? recentNotesOrdered.map((note) => renderNoteRow(note, 0))
                  : null}
                {browseTab === "sessions" ? (
                  touchSessionsLoading ? (
                    <div className="px-3 py-4 text-sm text-trellis-muted">Loading sessions…</div>
                  ) : touchSessions.length === 0 ? (
                    <div className="rounded-panel border border-dashed border-trellis-border px-4 py-5 text-sm text-trellis-muted">
                      No chat sessions have written to this vault yet. Keep chatting — extractions
                      show up here.
                    </div>
                  ) : (
                    <div className="space-y-1">
                      {touchSessions.map((session) => (
                        <div
                          key={session.sessionId}
                          className="flex items-center gap-1 rounded-field border border-transparent transition hover:border-trellis-border hover:bg-trellis-surface-2"
                        >
                          <button
                            type="button"
                            className="min-w-0 flex-1 px-2.5 py-2 text-left"
                            onClick={() => {
                              setActiveChatSession(session.sessionId);
                              navigate("/chat");
                            }}
                          >
                            <span className="block truncate text-[13px] font-medium text-trellis-text">
                              {session.sessionTitle?.trim() || "Untitled chat"}
                            </span>
                            <span className="mt-0.5 block text-[11px] text-trellis-faint">
                              {session.touchCount} vault update{session.touchCount === 1 ? "" : "s"} ·{" "}
                              {new Date(session.lastTouchAt).toLocaleDateString(undefined, {
                                month: "short",
                                day: "numeric"
                              })}
                            </span>
                          </button>
                          <MessageSquare className="mr-2 h-3.5 w-3.5 shrink-0 text-trellis-faint" aria-hidden />
                        </div>
                      ))}
                    </div>
                  )
                ) : null}
                {browseTab === "explorer" &&
                rootFolders.length === 0 &&
                rootNotes.length === 0 ? (
                  <div className="rounded-panel border border-dashed border-trellis-border px-4 py-5 text-sm text-trellis-muted">
                    {hasSidebarFilters
                      ? "No Strands match the current search or tag filter."
                      : "No Strands in folders yet. Switch to Recent, or create a Strand or folder."}
                  </div>
                ) : null}
                {browseTab === "recent" && recentNotesOrdered.length === 0 ? (
                  <div className="rounded-panel border border-dashed border-trellis-border px-4 py-5 text-sm text-trellis-muted">
                    {hasSidebarFilters
                      ? "No Strands match the current search or tag filter."
                      : "No Strands yet. Chat to compound memory into your vault."}
                  </div>
                ) : null}
              </div>
            </div>
        </section>
      </div>

      <div
        className={cn(
          "relative z-10 flex shrink-0 items-center justify-center transition-[width] duration-300 ease-out motion-reduce:transition-none motion-reduce:duration-0",
          listCollapsed ? "w-0 overflow-hidden" : "w-3"
        )}
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize Strand list"
      >
        {!listCollapsed ? (
          <button
            type="button"
            tabIndex={-1}
            aria-hidden
            className="group absolute inset-y-8 -left-2 -right-2 z-10 flex cursor-col-resize items-center justify-center bg-transparent"
            title="Drag to resize Strand list. Double-click to hide list."
            onMouseDown={(event) => {
              if (event.button !== 0) {
                return;
              }
              event.preventDefault();
              beginListResize(event.clientX);
            }}
            onDoubleClick={(event) => {
              event.preventDefault();
              setListCollapsed(true);
            }}
          >
            <span className="h-24 w-px rounded-full bg-trellis-border transition group-hover:bg-trellis-accent/45" />
          </button>
        ) : null}
      </div>

      <section className="trellis-panel relative min-h-0 min-w-0 flex-1 overflow-hidden">
        {listCollapsed ? (
          <button
            type="button"
            className="absolute left-4 top-4 z-20 inline-flex h-9 w-9 items-center justify-center rounded-field border border-trellis-border bg-trellis-surface-2 text-trellis-muted shadow-[var(--trellis-elevated-shadow)] transition hover:border-trellis-accent/30 hover:text-trellis-text md:left-6 motion-reduce:transition-none"
            aria-label="Show Strand list"
            title="Show Strand list"
            onClick={() => {
              setListCollapsed(false);
            }}
          >
            <Folder className="h-4 w-4" aria-hidden />
          </button>
        ) : null}
        {activeNote ? (
          <div className="flex h-full flex-col">
            <div
              data-trellis-wiki-note-scroll
              className={cn(
                "trellis-scrollbar min-h-0 flex-1 overflow-y-auto px-4 pb-4 pt-0 md:px-6 md:pb-5 md:pt-0",
                listCollapsed && "pt-12"
              )}
            >
              <NoteViewer
                note={activeNote}
                existingSlugs={notes.map((note) => note.slug)}
                wikiNotes={notes.map((note) => ({ slug: note.slug, title: note.title }))}
                allTags={allTags}
                editable
                workspaceId={workspaceId}
                variant="page"
                onOpenLink={(slug, options) => {
                  void handleOpenWikiLink(slug, options);
                }}
                onSave={(content, slug) => {
                  void handleSave(content, slug);
                }}
                onSaveTitle={(title, slug) => {
                  void handleSaveTitle(title, slug);
                }}
                onSelectTag={(tag) => {
                  setSelectedTag((current) => (current === tag ? null : tag));
                }}
                onAddTag={(tag) => {
                  void handleAddTag(tag);
                }}
                onRemoveTag={(tag) => {
                  void handleRemoveTag(tag);
                }}
                onDeleteNote={() => {
                  void handleDeleteNote();
                }}
                strandProvenance={strandProvenance}
                onOpenStrandSession={(sessionId) => {
                  setActiveChatSession(sessionId);
                  navigate("/chat");
                }}
              />
            </div>
          </div>
        ) : (
          <div
            className={cn(
              "flex h-full flex-col items-center justify-center px-8 text-center",
              listCollapsed && "pt-14"
            )}
          >
            <FileText className="h-8 w-8 text-trellis-accent/80" />
            <p className="mt-4 font-display text-2xl text-trellis-text">Choose a Strand</p>
            <p className="mt-2 max-w-md text-sm leading-7 text-trellis-muted">
              Browse Recent or From chats first, or use Explorer when you need folders. Strands are
              the durable pages your chats compound into.
            </p>
          </div>
        )}
      </section>
    </div>
  );
}
