import { create } from "zustand";
import type { ThoughtRecord } from "@trellis/contracts";
import { listThoughtsBridged } from "@/lib/cloud/thoughts";

interface ThoughtState {
  thoughts: ThoughtRecord[];
  hydrate: (bucketId: string) => Promise<void>;
  prependThought: (thought: ThoughtRecord) => void;
  upsertThought: (thought: ThoughtRecord) => void;
  clear: () => void;
}

export const useThoughtStore = create<ThoughtState>((set) => ({
  thoughts: [],
  clear: () => set({ thoughts: [] }),
  hydrate: async (bucketId) => {
    const list = await listThoughtsBridged(bucketId);
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
