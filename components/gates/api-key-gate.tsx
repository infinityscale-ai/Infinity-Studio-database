"use client";

import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { API_BASE, UNAUTHORIZED_EVENT, apiFetch, storeApiKey, type UnauthorizedDetail } from "@/lib/api-base";
import { isDesktopRuntime } from "@/lib/desktop";
import { isEmbedMode } from "@/lib/embed/session";

export type GateDecision = "pass" | "probe";
type GateStatus = "checking" | "ready" | "locked" | "unreachable";
type ProbeOutcome = { status: GateStatus; error: string | null };

// Decides whether the access-key gate applies: desktop and embedded sessions never see it.
export function decideApiKeyGate(input: { isDesktop: boolean; isEmbed: boolean }): GateDecision {
  return input.isDesktop || input.isEmbed ? "pass" : "probe";
}

// Asks the server whether the current credentials are accepted.
async function probeServer(): Promise<ProbeOutcome> {
  try {
    const res = await apiFetch("/api/auth/probe");
    if (res.ok) return { status: "ready", error: null };
    if (res.status === 401) return { status: "locked", error: null };
    return { status: "unreachable", error: `Cannot reach the Infinity Studio server at ${API_BASE} (HTTP ${res.status}).` };
  } catch {
    return { status: "unreachable", error: `Cannot reach the Infinity Studio server at ${API_BASE}.` };
  }
}

// Gates the web build behind the server access key; desktop and embed render children directly.
export function ApiKeyGate({ children }: { children: ReactNode }) {
  const [applies, setApplies] = useState(false);
  const [status, setStatus] = useState<GateStatus>("checking");
  const [error, setError] = useState<string | null>(null);

  const probe = useCallback(async () => {
    const outcome = await probeServer();
    setStatus(outcome.status);
    setError(outcome.error);
  }, []);

  useEffect(() => {
    const decision = decideApiKeyGate({ isDesktop: isDesktopRuntime(), isEmbed: isEmbedMode() });
    if (decision === "pass") {
      setStatus("ready");
      return;
    }
    setApplies(true);
    void probe();
  }, [probe]);

  useEffect(() => {
    if (!applies) return;
    const onUnauthorized = (event: Event) => {
      const detail = (event as CustomEvent<UnauthorizedDetail>).detail;
      if (!detail?.embed) setStatus("locked");
    };
    window.addEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
  }, [applies]);

  const submit = useCallback(async (key: string) => {
    storeApiKey(key);
    const outcome = await probeServer();
    setStatus(outcome.status);
    setError(outcome.status === "locked" ? "The server rejected this key." : outcome.error);
  }, []);

  if (status === "ready") return <>{children}</>;
  if (status === "locked") return <AccessKeyForm error={error} onSubmit={submit} />;
  return <GateNotice status={status} error={error} onRetry={() => void probe()} />;
}

type GateNoticeProps = { status: "checking" | "unreachable"; error: string | null; onRetry: () => void };

// Shows the checking or unreachable state, with a retry for the latter.
function GateNotice({ status, error, onRetry }: GateNoticeProps) {
  return (
    <GateShell>
      {status === "checking" ? (
        <p className="text-sm text-muted-foreground">Checking server access…</p>
      ) : (
        <>
          <p role="alert" className="text-sm text-destructive">{error}</p>
          <Button type="button" onClick={onRetry}>Retry</Button>
        </>
      )}
    </GateShell>
  );
}

// The access-key form: a labelled password field, the failure line, and a submit button.
function AccessKeyForm({ error, onSubmit }: { error: string | null; onSubmit: (key: string) => Promise<void> }) {
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!key.trim() || busy) return;
    setBusy(true);
    try {
      await onSubmit(key.trim());
    } finally {
      setBusy(false);
    }
  };

  return (
    <GateShell>
      <form onSubmit={handleSubmit} className="flex w-full flex-col gap-3">
        <h1 className="text-base font-semibold">Infinity Studio</h1>
        <p className="text-sm text-muted-foreground">This server requires an access key.</p>
        <Label htmlFor="server-access-key">Server access key</Label>
        <Input
          id="server-access-key"
          type="password"
          autoComplete="off"
          value={key}
          onChange={(event) => setKey(event.target.value)}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? "server-access-key-error" : undefined}
        />
        {error ? (
          <p id="server-access-key-error" role="alert" className="text-sm text-destructive">{error}</p>
        ) : null}
        <Button type="submit" disabled={busy || !key.trim()}>{busy ? "Checking…" : "Continue"}</Button>
      </form>
    </GateShell>
  );
}

// Centres gate content on the app background.
function GateShell({ children }: { children: ReactNode }) {
  return (
    <main className="flex min-h-svh items-center justify-center bg-background p-6 text-foreground">
      <div className="flex w-full max-w-sm flex-col items-start gap-3">{children}</div>
    </main>
  );
}
