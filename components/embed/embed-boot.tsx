"use client";

import { useEffect, useState } from "react";
import StudioClient from "@/app/studio/StudioClient";
import { UNAUTHORIZED_EVENT, type UnauthorizedDetail } from "@/lib/api-base";
import { claimEmbedSession, readTokenFromHash, type EmbedEndReason } from "@/lib/embed/claim";
import {
  clearEmbedSession,
  getEmbedSession,
  isEmbedSessionExpired,
  notifyParent,
  storeEmbedSession,
} from "@/lib/embed/session";
import { EmbedExpired } from "./embed-expired";
import { EmbedSkeleton } from "./embed-skeleton";

export type BootState =
  | { status: "claiming" }
  | { status: "ready"; connectionId: number }
  | { status: "ended"; reason: EmbedEndReason };

// Removes the token from the address bar so it never shows in history, a bookmark, or a screenshot.
function stripHash(): void {
  window.history.replaceState(null, "", window.location.pathname + window.location.search);
}

// Decides how the page boots: reuse this tab's session, claim the token from the fragment, or report the end.
export async function resolveBoot(): Promise<BootState> {
  const token = readTokenFromHash(window.location.hash);
  if (token) stripHash();
  const stored = getEmbedSession();
  const reusable = stored !== null && !isEmbedSessionExpired(stored) && (token === null || stored.claimedToken === token);
  if (stored && reusable) return { status: "ready", connectionId: stored.connectionId };
  if (!token) return { status: "ended", reason: stored ? "expired" : "missing" };
  const outcome = await claimEmbedSession(token);
  if (!outcome.ok) return { status: "ended", reason: outcome.reason };
  storeEmbedSession(outcome.session);
  return { status: "ready", connectionId: outcome.session.connectionId };
}

// Ends a running session when the server rejects its bearer; a 401 before the claim is just a call made too early.
function useUnauthorizedEnd(setState: (update: (prev: BootState) => BootState) => void): void {
  useEffect(() => {
    const onUnauthorized = (event: Event) => {
      const detail = (event as CustomEvent<UnauthorizedDetail>).detail;
      if (!detail?.embed) return;
      setState((prev) => (prev.status === "ready" ? { status: "ended", reason: "revoked" } : prev));
    };
    window.addEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
  }, [setState]);
}

// Boots the embedded studio: claims the console's token once, then renders the studio on that one connection.
export function EmbedBoot() {
  const [state, setState] = useState<BootState>({ status: "claiming" });

  useEffect(() => {
    let mounted = true;
    void resolveBoot().then((next) => {
      if (mounted) setState(next);
    });
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (state.status === "claiming") return;
    notifyParent(state.status === "ready" ? "infinity-studio:ready" : "infinity-studio:session-expired");
    if (state.status === "ended") clearEmbedSession();
  }, [state]);

  useUnauthorizedEnd(setState);

  if (state.status === "claiming") return <EmbedSkeleton />;
  if (state.status === "ended") return <EmbedExpired reason={state.reason} />;
  return <StudioClient connectionId={state.connectionId} />;
}
