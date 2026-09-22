"use client";

import { useCallback, useEffect, useState } from "react";

import {
  LOCAL_USER_ID,
  PROFILE_CHANGED_EVENT,
  resolveLocalUserProfile,
} from "@/lib/auth/user-profile";
import { getEmbedSession, isEmbedMode } from "@/lib/embed/session";

export interface AuthState {
  authResolved: boolean;
  displayName: string;
  email: string | null;
  userId: string;
}

const INITIAL_AUTH_STATE: AuthState = {
  authResolved: false,
  displayName: "User",
  email: null,
  userId: LOCAL_USER_ID,
};

// Builds the auth state of an embedded session: the console's user, never the local profile; null outside embed mode.
function embedAuthState(): AuthState | null {
  const session = getEmbedSession();
  if (!session) return null;
  return { authResolved: true, displayName: session.displayName, email: null, userId: session.externalId };
}

// Exposes the single local user profile and re-reads it whenever the profile is saved; embed sessions carry their own.
export function useAuthState(): AuthState {
  const [state, setState] = useState<AuthState>(() => embedAuthState() ?? INITIAL_AUTH_STATE);

  const hydrate = useCallback(async () => {
    const profile = await resolveLocalUserProfile();
    setState({
      authResolved: true,
      displayName: profile.name,
      email: profile.email,
      userId: LOCAL_USER_ID,
    });
  }, []);

  useEffect(() => {
    if (isEmbedMode()) return;
    let mounted = true;
    const run = () => {
      void hydrate().catch(() => {
        if (mounted) setState((prev) => ({ ...prev, authResolved: true }));
      });
    };
    run();
    window.addEventListener(PROFILE_CHANGED_EVENT, run);
    return () => {
      mounted = false;
      window.removeEventListener(PROFILE_CHANGED_EVENT, run);
    };
  }, [hydrate]);

  return state;
}
