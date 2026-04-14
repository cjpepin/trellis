import { create } from "zustand";
import type { ThoughtRecord } from "@electron/ipc/types";

interface ThoughtState {
  thoughts: ThoughtRecord[];
  hydrate: (vaultId: string) => Promise<void>;
  prependThought: (thought: ThoughtRecord) => void;
  upsertThought: (thought: ThoughtRecord) => void;
  clear: () => void;
}

export const useThoughtStore = create<ThoughtState>((set) => ({
  thoughts: [],
  clear: () => set({ thoughts: [] }),
  hydrate: async (vaultId) => {
    const list = await window.trellis.db.listThoughts(vaultId);
    set({ thoughts: list });
  },
  prependThought: (thought) =>
    set((state) => ({
      thoughts: [thought, ...state.thoughts.filter((row) => row.id !== thought.id)]
    })),
  upsertThought: (thought) =>
    set((state) => {
      const rest = state.thoughts.filter((row) => row.id !== thought.id);
      return { thoughts: [thought, ...rest] };
    })
}));
