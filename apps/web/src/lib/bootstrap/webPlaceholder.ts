import type {
  AppBootstrap,
  AppFeatureFlags,
  AppSettings,
  GraphData,
  ProviderKeyStatusSnapshot,
  WorkspaceInfo
} from "@trellis/contracts";
import { defaultChatModel } from "@trellis/contracts";
import { mergeCloudSyncEnabledFromPlatform } from "@trellis/shared/cloud/mergePreferences";
import type { JsonObject } from "@trellis/shared/cloud/types";

const WEB_SYNTHETIC_BUCKET_ID = "cloud-primary";

const personalWorkspace: WorkspaceInfo = {
  id: "personal",
  label: "Personal",
  description: "Your cloud workspace",
  localOnly: false,
  canReset: false,
  isPreview: false,
  seedVersion: null
};

const emptyGraph: GraphData = { nodes: [], edges: [] };

const emptyProviderKeys: ProviderKeyStatusSnapshot = {
  statuses: [
    { provider: "openai", configured: false, lastFour: null, updatedAt: null },
    { provider: "anthropic", configured: false, lastFour: null, updatedAt: null }
  ],
  secureStorageAvailable: false,
  persistenceMode: "encrypted"
};

const webFeatures: AppFeatureFlags = {
  localExtraction: false
};

export function getWebSyntheticBucketId(): string {
  return WEB_SYNTHETIC_BUCKET_ID;
}

export function buildWebPlaceholderSettings(): AppSettings {
  return {
    buckets: [{ id: WEB_SYNTHETIC_BUCKET_ID, name: "Cloud", path: "" }],
    activeBucketId: WEB_SYNTHETIC_BUCKET_ID,
    theme: "dark",
    rememberSession: true,
    cloudSyncEnabled: true,
    chat: {
      privacyMode: "auto",
      readAloudAutoPlay: false,
      scrollWithResponse: true
    },
    extraction: {
      mode: "local",
      preferredLocalModelId: null
    }
  };
}

/**
 * Minimal bootstrap so the SPA can render before Supabase session + `app-bootstrap` hydrate.
 */
export function buildWebPlaceholderBootstrap(): AppBootstrap {
  return {
    settings: buildWebPlaceholderSettings(),
    features: webFeatures,
    workspace: personalWorkspace,
    workspaces: [personalWorkspace],
    providerKeys: emptyProviderKeys,
    needsWorkspaceChoice: false,
    authSession: null as AppBootstrap["authSession"],
    sessions: [],
    notes: [],
    folders: [],
    graph: emptyGraph
  };
}

export function mergeCloudPreferencesIntoSettings(
  settings: AppSettings,
  prefs: {
    theme: string | null;
    chat: Record<string, unknown>;
    platform?: Record<string, unknown>;
  }
): AppSettings {
  const nextChat = { ...settings.chat };
  const rawPrivacy = prefs.chat["privacyMode"];
  if (rawPrivacy === "auto" || rawPrivacy === "off" || rawPrivacy === "local") {
    nextChat.privacyMode = rawPrivacy;
  }
  const rawReadAloud = prefs.chat["readAloudAutoPlay"];
  if (typeof rawReadAloud === "boolean") {
    nextChat.readAloudAutoPlay = rawReadAloud;
  }
  const rawScroll = prefs.chat["scrollWithResponse"];
  if (typeof rawScroll === "boolean") {
    nextChat.scrollWithResponse = rawScroll;
  }
  const rawSpeed = prefs.chat["readAloudSpeed"];
  if (
    rawSpeed === 1 ||
    rawSpeed === 2 ||
    rawSpeed === 3 ||
    rawSpeed === 4 ||
    rawSpeed === 5
  ) {
    nextChat.readAloudSpeed = rawSpeed;
  }

  const cloudSyncEnabled = mergeCloudSyncEnabledFromPlatform(
    settings.cloudSyncEnabled,
    prefs.platform
  );

  const theme =
    prefs.theme &&
    [
      "dark",
      "light",
      "nature-dark",
      "nature-light",
      "ocean-dark",
      "ocean-light",
      "high-contrast",
      "twilight",
      "dawn",
      "graphite",
      "cream",
      "ember",
      "fog"
    ].includes(prefs.theme)
      ? prefs.theme
      : settings.theme;

  const resolvedTheme = theme as AppSettings["theme"];

  const chatUnchanged =
    nextChat.privacyMode === settings.chat.privacyMode &&
    nextChat.readAloudAutoPlay === settings.chat.readAloudAutoPlay &&
    nextChat.scrollWithResponse === settings.chat.scrollWithResponse &&
    nextChat.readAloudSpeed === settings.chat.readAloudSpeed;

  if (resolvedTheme === settings.theme && cloudSyncEnabled === settings.cloudSyncEnabled && chatUnchanged) {
    return settings;
  }

  return {
    ...settings,
    theme: resolvedTheme,
    cloudSyncEnabled,
    chat: nextChat
  };
}

export function settingsToCloudPlatformJson(settings: AppSettings): JsonObject {
  return {
    cloudSyncEnabled: settings.cloudSyncEnabled
  };
}

export function settingsToCloudChatJson(settings: AppSettings): JsonObject {
  return {
    privacyMode: settings.chat.privacyMode,
    readAloudAutoPlay: settings.chat.readAloudAutoPlay ?? false,
    scrollWithResponse: settings.chat.scrollWithResponse ?? true,
    readAloudSpeed: settings.chat.readAloudSpeed ?? null,
    defaultChatModel
  };
}
