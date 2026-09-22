"use client";

import { useCallback, useEffect, useState } from "react";

import {
  LOCAL_USER_ID,
  PROFILE_CHANGED_EVENT,
  resolveLocalUserProfile,
} from "@/lib/auth/user-profile";

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

// Exposes the single local user profile and re-reads it whenever the profile is saved.
export function useAuthState(): AuthState {
  const [state, setState] = useState<AuthState>(INITIAL_AUTH_STATE);

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
