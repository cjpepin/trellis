import { create } from "zustand";
import type { FolderSummary, GraphData, NoteSummary, WikiNote } from "@electron/ipc/types";

interface WikiState {
  notes: NoteSummary[];
  folders: FolderSummary[];
  graph: GraphData;
  noteCache: Record<string, WikiNote>;
  activeNoteSlug: string | null;
  isHydrated: boolean;
  hydrate: (payload: { notes: NoteSummary[]; folders: FolderSummary[]; graph: GraphData }) => void;
  setActiveNote: (slug: string | null) => void;
  setNote: (note: WikiNote) => void;
  replaceIndex: (payload: {
    notes: NoteSummary[];
    folders: FolderSummary[];
    graph: GraphData;
  }) => void;
}

function upsertNoteSummary(notes: NoteSummary[], note: WikiNote): NoteSummary[] {
  const summary: NoteSummary = {
    slug: note.slug,
    title: note.title,
    updated: note.updated,
    tags: note.tags,
    type: note.type,
    excerpt: note.excerpt,
    inboundCount: note.inboundCount,
    folderPath: note.folderPath,
    relativePath: note.relativePath
  };
  const rest = notes.filter((item) => item.slug !== note.slug);
  return [summary, ...rest].sort((left, right) => right.updated.localeCompare(left.updated));
}

export const useWikiStore = create<WikiState>((set) => ({
  notes: [],
  folders: [],
  graph: {
    nodes: [],
    edges: []
  },
  noteCache: {},
  activeNoteSlug: null,
  isHydrated: false,
  hydrate: ({ notes, folders, graph }) =>
    set({
      notes,
      folders,
      graph,
      noteCache: {},
      activeNoteSlug: notes[0]?.slug ?? null,
      isHydrated: true
    }),
  setActiveNote: (slug) => set({ activeNoteSlug: slug }),
  setNote: (note) =>
    set((state) => ({
      noteCache: {
        ...state.noteCache,
        [note.slug]: note
      },
      notes: upsertNoteSummary(state.notes, note)
    })),
  replaceIndex: ({ notes, folders, graph }) =>
    set((state) => ({
      notes,
      folders,
      graph,
      noteCache: Object.fromEntries(
        Object.entries(state.noteCache)
          .filter(([slug]) => notes.some((note) => note.slug === slug))
          .map(([slug, cachedNote]) => {
            const summary = notes.find((note) => note.slug === slug);

            if (!summary) {
              return [slug, cachedNote];
            }

            return [
              slug,
              {
                ...cachedNote,
                title: summary.title,
                updated: summary.updated,
                tags: summary.tags,
                type: summary.type,
                excerpt: summary.excerpt,
                inboundCount: summary.inboundCount,
                folderPath: summary.folderPath,
                relativePath: summary.relativePath
              }
            ];
          })
      )
    }))
}));
