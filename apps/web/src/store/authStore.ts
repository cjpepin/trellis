import { create } from "zustand";
import type {
  ProviderKeyStatusSnapshot,
  SubscriptionTier
} from "@trellis/contracts";

export interface UsageSnapshot {
  messagesUsed: number;
  messageLimit: number;
  trialMessageWindowResetsAt: string | null;
  ingestsUsed: number;
  ingestLimit: number;
}

interface AuthState {
  status: "idle" | "loading" | "authenticated" | "anonymous" | "error";
  isConfigured: boolean;
  /** True when the session is a Supabase anonymous user (guest). */
  isAnonymousUser: boolean;
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
  /** ISO time when self-service account deletion was requested; blocks cloud until resolved. */
  accountDeletedAt: string | null;
  setConfigured: (configured: boolean) => void;
  setLoading: () => void;
  setAuthenticated: (payload: {
    accessToken: string;
    user: { id: string; email: string | null };
    isAnonymousUser: boolean;
    subscriptionTier: SubscriptionTier;
    subscriptionStatus: "trialing" | "active" | "expired";
    isAdmin: boolean;
    usage: UsageSnapshot;
    accountDeletedAt: string | null;
  }) => void;
  setProviderKeys: (providerKeys: ProviderKeyStatusSnapshot) => void;
  setAnonymous: () => void;
  setError: (message: string) => void;
}

const defaultUsage: UsageSnapshot = {
  messagesUsed: 0,
  messageLimit: 25,
  trialMessageWindowResetsAt: null,
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
  isAnonymousUser: false,
  user: null,
  accessToken: null,
  subscriptionTier: "trial",
  subscriptionStatus: "trialing",
  isAdmin: false,
  usage: defaultUsage,
  providerKeys: defaultProviderKeys,
  errorMessage: null,
  accountDeletedAt: null,
  setConfigured: (configured) => set({ isConfigured: configured }),
  setLoading: () => set({ status: "loading", errorMessage: null }),
  setAuthenticated: (payload) =>
    set({
      status: "authenticated",
      isAnonymousUser: payload.isAnonymousUser,
      user: payload.user,
      accessToken: payload.accessToken,
      subscriptionTier: payload.subscriptionTier,
      subscriptionStatus: payload.subscriptionStatus,
      isAdmin: payload.isAdmin,
      usage: payload.usage,
      accountDeletedAt: payload.accountDeletedAt,
      errorMessage: null
    }),
  setProviderKeys: (providerKeys) => set({ providerKeys }),
  setAnonymous: () =>
    set((state) => {
      if (
        state.status === "anonymous" &&
        state.user === null &&
        state.accessToken === null
      ) {
        return state;
      }
      return {
        status: "anonymous" as const,
        isAnonymousUser: false,
        user: null,
        accessToken: null,
        subscriptionTier: "trial" as const,
        subscriptionStatus: "trialing" as const,
        isAdmin: false,
        usage: defaultUsage,
        accountDeletedAt: null,
        errorMessage: null
      };
    }),
  setError: (message) =>
    set({
      status: "error",
      isAnonymousUser: false,
      errorMessage: message
    })
}));
