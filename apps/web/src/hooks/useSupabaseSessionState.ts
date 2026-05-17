import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { getProfileSnapshot, type ProfileSnapshot } from "@/lib/auth";
import { getSupabase, hasSupabaseConfig } from "@/lib/supabase";

interface SupabaseSessionState {
  loading: boolean;
  session: Session | null;
  profile: ProfileSnapshot | null;
  isAdmin: boolean;
  isAnonymousUser: boolean;
}

function getIsAnonymousUser(session: Session | null): boolean {
  return session?.user.is_anonymous === true;
}

export function useSupabaseSessionState(): SupabaseSessionState {
  const [state, setState] = useState<SupabaseSessionState>({
    loading: hasSupabaseConfig(),
    session: null,
    profile: null,
    isAdmin: false,
    isAnonymousUser: false
  });

  useEffect(() => {
    if (!hasSupabaseConfig()) {
      setState({
        loading: false,
        session: null,
        profile: null,
        isAdmin: false,
        isAnonymousUser: false
      });
      return;
    }

    let cancelled = false;

    async function syncSession(session: Session | null): Promise<void> {
      if (!session) {
        if (!cancelled) {
          setState({
            loading: false,
            session: null,
            profile: null,
            isAdmin: false,
            isAnonymousUser: false
          });
        }
        return;
      }

      const profile = await getProfileSnapshot(session.user.id).catch(() => null);

      if (!cancelled) {
        setState({
          loading: false,
          session,
          profile,
          isAdmin: profile?.isAdmin === true,
          isAnonymousUser: getIsAnonymousUser(session)
        });
      }
    }

    void getSupabase()
      .auth.getSession()
      .then(({ data }) => syncSession(data.session ?? null))
      .catch(() => {
        if (!cancelled) {
          setState((current) => ({ ...current, loading: false }));
        }
      });

    const {
      data: { subscription }
    } = getSupabase().auth.onAuthStateChange((_event, session) => {
      setTimeout(() => {
        void syncSession(session ?? null);
      }, 0);
    });

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, []);

  return state;
}
