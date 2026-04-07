import { create } from "zustand";

export interface ToastItem {
  id: string;
  title: string;
  tone: "default" | "success" | "warning" | "error";
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

