import { create } from "zustand";
import type { GraphData, NoteSummary, WikiNote } from "@electron/ipc/types";

interface WikiState {
  notes: NoteSummary[];
  graph: GraphData;
  noteCache: Record<string, WikiNote>;
  activeNoteSlug: string | null;
  isHydrated: boolean;
  hydrate: (payload: { notes: NoteSummary[]; graph: GraphData }) => void;
  setActiveNote: (slug: string | null) => void;
  setNote: (note: WikiNote) => void;
  replaceIndex: (payload: { notes: NoteSummary[]; graph: GraphData }) => void;
}

function upsertNoteSummary(notes: NoteSummary[], note: WikiNote): NoteSummary[] {
  const summary: NoteSummary = {
    slug: note.slug,
    title: note.title,
    updated: note.updated,
    tags: note.tags,
    type: note.type,
    excerpt: note.excerpt,
    inboundCount: note.inboundCount
  };
  const rest = notes.filter((item) => item.slug !== note.slug);
  return [summary, ...rest].sort((left, right) => right.updated.localeCompare(left.updated));
}

export const useWikiStore = create<WikiState>((set) => ({
  notes: [],
  graph: {
    nodes: [],
    edges: []
  },
  noteCache: {},
  activeNoteSlug: null,
  isHydrated: false,
  hydrate: ({ notes, graph }) =>
    set({
      notes,
      graph,
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
  replaceIndex: ({ notes, graph }) =>
    set((state) => ({
      notes,
      graph,
      noteCache: Object.fromEntries(
        Object.entries(state.noteCache).filter(([slug]) =>
          notes.some((note) => note.slug === slug)
        )
      )
    }))
}));

