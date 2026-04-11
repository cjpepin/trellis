import { create } from "zustand";
import type { ToastNoteLink } from "@electron/ipc/types";

export interface ToastItem {
  id: string;
  title: string;
  tone: "default" | "success" | "warning" | "error";
  /** Optional links to open notes in the Notes route */
  noteLinks?: ToastNoteLink[];
}

interface UiState {
  commandPaletteOpen: boolean;
  toasts: ToastItem[];
  setCommandPaletteOpen: (open: boolean) => void;
  pushToast: (toast: Omit<ToastItem, "id">) => void;
  removeToast: (id: string) => void;
}

export const useUiStore = create<UiState>((set) => ({
  commandPaletteOpen: false,
  toasts: [],
  setCommandPaletteOpen: (open) => set({ commandPaletteOpen: open }),
  pushToast: (toast) =>
    set((state) => ({
      toasts: [...state.toasts, { id: crypto.randomUUID(), ...toast }].slice(-4)
    })),
  removeToast: (id) =>
    set((state) => ({
      toasts: state.toasts.filter((toast) => toast.id !== id)
    }))
}));

