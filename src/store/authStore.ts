import { create } from "zustand";
import type {
  ProviderKeyStatusSnapshot,
  SubscriptionTier
} from "@electron/ipc/types";

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
  subscriptionTier: SubscriptionTier;
  subscriptionStatus: "trialing" | "active" | "expired";
  isAdmin: boolean;
  usage: UsageSnapshot;
  providerKeys: ProviderKeyStatusSnapshot;
  errorMessage: string | null;
  setConfigured: (configured: boolean) => void;
  setLoading: () => void;
  setAuthenticated: (payload: {
    accessToken: string;
    user: { id: string; email: string | null };
    subscriptionTier: SubscriptionTier;
    subscriptionStatus: "trialing" | "active" | "expired";
    isAdmin: boolean;
    usage: UsageSnapshot;
  }) => void;
  setProviderKeys: (providerKeys: ProviderKeyStatusSnapshot) => void;
  setAnonymous: () => void;
  setError: (message: string) => void;
}

const defaultUsage: UsageSnapshot = {
  messagesUsed: 0,
  messageLimit: 50,
  ingestsUsed: 0,
  ingestLimit: 5
};

const defaultProviderKeys: ProviderKeyStatusSnapshot = {
  statuses: [
    {
      provider: "openai",
      configured: false,
      lastFour: null,
      updatedAt: null
    },
    {
      provider: "anthropic",
      configured: false,
      lastFour: null,
      updatedAt: null
    }
  ],
  secureStorageAvailable: false,
  persistenceMode: "session"
};

export const useAuthStore = create<AuthState>((set) => ({
  status: "idle",
  isConfigured: false,
  user: null,
  accessToken: null,
  subscriptionTier: "trial",
  subscriptionStatus: "trialing",
  isAdmin: false,
  usage: defaultUsage,
  providerKeys: defaultProviderKeys,
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
      isAdmin: payload.isAdmin,
      usage: payload.usage,
      errorMessage: null
    }),
  setProviderKeys: (providerKeys) => set({ providerKeys }),
  setAnonymous: () =>
    set({
      status: "anonymous",
      user: null,
      accessToken: null,
      subscriptionTier: "trial",
      subscriptionStatus: "trialing",
      isAdmin: false,
      usage: defaultUsage,
      errorMessage: null
    }),
  setError: (message) =>
    set({
      status: "error",
      errorMessage: message
    })
}));
