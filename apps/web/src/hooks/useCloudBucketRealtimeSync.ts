import { useEffect, useRef } from "react";
import { getSupabase, hasSupabaseConfig } from "@/lib/supabase";

const debounceMs = 450;

export function useCloudBucketRealtimeSync(options: {
  enabled: boolean;
  cloudWorkspaceId: string | null;
  onRefresh: () => Promise<void>;
}): void {
  const { enabled, cloudWorkspaceId, onRefresh } = options;
  const onRefreshRef = useRef(onRefresh);

  onRefreshRef.current = onRefresh;

  useEffect(() => {
    if (!enabled || !cloudWorkspaceId || !hasSupabaseConfig()) {
      return;
    }

    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    let cancelled = false;

    const scheduleRefresh = (): void => {
      if (debounceTimer !== null) {
        clearTimeout(debounceTimer);
      }
      debounceTimer = setTimeout(() => {
        debounceTimer = null;
        if (!cancelled) {
          void onRefreshRef.current().catch((error) => {
            console.warn("Cloud vault realtime refresh failed.", error);
          });
        }
      }, debounceMs);
    };

    const supabase = getSupabase();
    const channelName = `cloud-vault:${cloudWorkspaceId}`;
    const filter = `workspace_id=eq.${cloudWorkspaceId}`;

    const channel = supabase
      .channel(channelName)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "notes", filter },
        scheduleRefresh
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "note_links", filter },
        scheduleRefresh
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "thoughts", filter },
        scheduleRefresh
      )
      .subscribe((status) => {
        if (status === "CHANNEL_ERROR") {
          console.warn("Cloud vault realtime channel error:", channelName);
        }
      });

    return () => {
      cancelled = true;
      if (debounceTimer !== null) {
        clearTimeout(debounceTimer);
      }
      void supabase.removeChannel(channel);
    };
  }, [enabled, cloudWorkspaceId]);
}
