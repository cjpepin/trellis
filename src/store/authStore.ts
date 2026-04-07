import { create } from "zustand";

export interface UsageSnapshot {
  messagesUsed: number;
  messageLimit: number;
  ingestsUsed: number;
  ingestLimit: number;
}

interface AuthState {
  status: "idle" | "loading" | "authenticated" | "anonymous" | "error";
  isConfigured: boolean;
  user: {
    id: string;
    email: string | null;
  } | null;
  accessToken: string | null;
  subscriptionTier: "trial" | "pro";
  subscriptionStatus: "trialing" | "active" | "expired";
  usage: UsageSnapshot;
  errorMessage: string | null;
  setConfigured: (configured: boolean) => void;
  setLoading: () => void;
  setAuthenticated: (payload: {
    accessToken: string;
    user: { id: string; email: string | null };
    subscriptionTier: "trial" | "pro";
    subscriptionStatus: "trialing" | "active" | "expired";
    usage: UsageSnapshot;
  }) => void;
  setAnonymous: () => void;
  setError: (message: string) => void;
}

const defaultUsage: UsageSnapshot = {
  messagesUsed: 0,
  messageLimit: 50,
  ingestsUsed: 0,
  ingestLimit: 5
};

export const useAuthStore = create<AuthState>((set) => ({
  status: "idle",
  isConfigured: false,
  user: null,
  accessToken: null,
  subscriptionTier: "trial",
  subscriptionStatus: "trialing",
  usage: defaultUsage,
  errorMessage: null,
  setConfigured: (configured) => set({ isConfigured: configured }),
  setLoading: () => set({ status: "loading", errorMessage: null }),
  setAuthenticated: (payload) =>
    set({
      status: "authenticated",
      user: payload.user,
      accessToken: payload.accessToken,
      subscriptionTier: payload.subscriptionTier,
      subscriptionStatus: payload.subscriptionStatus,
      usage: payload.usage,
      errorMessage: null
    }),
  setAnonymous: () =>
    set({
      status: "anonymous",
      user: null,
      accessToken: null,
      subscriptionTier: "trial",
      subscriptionStatus: "trialing",
      usage: defaultUsage,
      errorMessage: null
    }),
  setError: (message) =>
    set({
      status: "error",
      errorMessage: message
    })
}));

