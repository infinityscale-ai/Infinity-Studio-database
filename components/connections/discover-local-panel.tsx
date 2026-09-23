"use client";

import { useCallback, useEffect, useState } from "react";
import { Database, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { discoverLocal } from "@/lib/api/discover-client";
import { candidateConnectionString, type DatabaseCandidate, type DiscoverResult, type SourceReport } from "@/lib/discovery/database-candidate";

/** The panel's four states. */
type ScanState = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; result: DiscoverResult };

/** How each source is named in the footer. */
const SOURCE_LABELS: Record<SourceReport["source"], string> = { ports: "Open ports", docker: "Docker", files: "Config files" };

// sourceLine summarizes what the scan could and could not look at.
function sourceLine(sources: SourceReport[]): string {
  return sources.map((s) => `${SOURCE_LABELS[s.source]}: ${s.status === "ok" ? "scanned" : s.detail || s.status}`).join(" · ");
}

// CandidateRow shows one found database and the button that takes it to the connection form.
function CandidateRow({ candidate, onPick }: { candidate: DatabaseCandidate; onPick: (cs: string) => void }) {
  const login = candidate.username ? `${candidate.username}${candidate.password ? " · password known" : ""}` : "no credentials found";
  return (
    <li className="flex items-center gap-3 rounded-lg border border-studio-border/60 bg-studio-bg/60 px-3 py-2">
      <Database className="size-4 shrink-0 text-muted-foreground" aria-hidden />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">{candidate.label}</div>
        <div className="truncate text-xs text-muted-foreground">
          {candidate.engine} · {candidate.host}:{candidate.port} · {login}
        </div>
      </div>
      <Button size="sm" variant="outline" onClick={() => onPick(candidateConnectionString(candidate))}>
        Use
      </Button>
    </li>
  );
}

// DiscoverLocalPanel scans this machine once when shown and lists what it found, with a rescan.
export function DiscoverLocalPanel({ onPick }: { onPick: (connectionString: string) => void }) {
  const [state, setState] = useState<ScanState>({ status: "loading" });
  const scan = useCallback(async () => {
    setState({ status: "loading" });
    try {
      setState({ status: "ready", result: await discoverLocal() });
    } catch (e) {
      setState({ status: "error", message: (e as Error).message || "The scan failed." });
    }
  }, []);
  useEffect(() => void scan(), [scan]);

  if (state.status === "loading") {
    return (
      <div role="status" aria-busy className="space-y-2">
        <span className="sr-only">Scanning this machine…</span>
        <Skeleton className="h-12 w-full rounded-lg" />
        <Skeleton className="h-12 w-full rounded-lg" />
        <Skeleton className="h-12 w-full rounded-lg" />
      </div>
    );
  }
  if (state.status === "error") {
    return (
      <div className="space-y-3 text-sm">
        <p className="text-destructive">Could not scan this machine: {state.message}</p>
        <Button size="sm" variant="outline" onClick={() => void scan()}>Try again</Button>
      </div>
    );
  }
  const { candidates, sources } = state.result;
  return (
    <div className="space-y-3">
      {candidates.length === 0 ? (
        <p className="rounded-lg border border-dashed border-studio-border/60 px-3 py-6 text-center text-sm text-muted-foreground">
          No database is listening on the usual ports here, and no Docker container publishes one.
        </p>
      ) : (
        <ul className="max-h-72 space-y-2 overflow-y-auto">{candidates.map((c) => <CandidateRow key={`${c.host}:${c.port}`} candidate={c} onPick={onPick} />)}</ul>
      )}
      <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
        <span className="truncate">{sourceLine(sources)}</span>
        <Button size="sm" variant="ghost" className="gap-1.5" onClick={() => void scan()}>
          <RefreshCw className="size-3.5" aria-hidden /> Rescan
        </Button>
      </div>
    </div>
  );
}
