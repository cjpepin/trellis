import { create } from "zustand";
import type { ToastNoteLink } from "@trellis/contracts";

export interface ToastItem {
  id: string;
  title: string;
  tone: "default" | "success" | "warning" | "error";
  /** Optional links to open notes in the Notes route */
  noteLinks?: ToastNoteLink[];
  /**
   * Auto-dismiss delay in ms. Omit for default (~3.4s). Set to 0 to keep the toast until removed.
   */
  durationMs?: number;
}

interface UiState {
  commandPaletteOpen: boolean;
  /** Capacitor: slide-over panel for sessions + vault (replaces desktop sidebar). */
  mobileWorkspaceDrawerOpen: boolean;
  guestQuotaModalOpen: boolean;
  toasts: ToastItem[];
  setCommandPaletteOpen: (open: boolean) => void;
  setMobileWorkspaceDrawerOpen: (open: boolean) => void;
  setGuestQuotaModalOpen: (open: boolean) => void;
  pushToast: (toast: Omit<ToastItem, "id">) => string;
  removeToast: (id: string) => void;
}

export const useUiStore = create<UiState>((set) => ({
  commandPaletteOpen: false,
  mobileWorkspaceDrawerOpen: false,
  guestQuotaModalOpen: false,
  toasts: [],
  setCommandPaletteOpen: (open) => set({ commandPaletteOpen: open }),
  setMobileWorkspaceDrawerOpen: (open) => set({ mobileWorkspaceDrawerOpen: open }),
  setGuestQuotaModalOpen: (open) => set({ guestQuotaModalOpen: open }),
  pushToast: (toast) => {
    const id = crypto.randomUUID();
    set((state) => ({
      toasts: [...state.toasts, { id, ...toast }].slice(-4)
    }));
    return id;
  },
  removeToast: (id) =>
    set((state) => ({
      toasts: state.toasts.filter((toast) => toast.id !== id)
    }))
}));
