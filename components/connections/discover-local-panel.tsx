"use client";

import { useCallback, useEffect, useState } from "react";
import { Laptop, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FoundDatabaseCard } from "@/components/connections/found-database-card";
import { FoundGroup, FoundNotice, FoundSkeleton, foundGridClass, type FoundColumns } from "@/components/connections/found-group";
import { discoverLocal } from "@/lib/api/discover-client";
import { candidateConnectionString, type DiscoverResult, type SourceReport } from "@/lib/discovery/database-candidate";
import { savedForEndpoint, type SavedLike } from "@/lib/discovery/saved-match";

/** The panel's four states. */
type ScanState = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; result: DiscoverResult };

/** What the local group needs: where a picked database goes, and the saved list to recognise it. */
export type DiscoverLocalPanelProps = { onPick: (connectionString: string) => void; saved?: SavedLike[]; onOpenSaved?: (id: number) => void; columns?: FoundColumns };

/** How each source is named in the header. */
const SOURCE_LABELS: Record<SourceReport["source"], string> = { ports: "ports", docker: "Docker", files: "config files" };

// sourceLine says in a few words what the scan could look at and what it could not.
function sourceLine(sources: SourceReport[]): string {
  const missed = sources.filter((s) => s.status !== "ok");
  if (missed.length === 0) return "Scanned ports, Docker and config files";
  return missed.map((s) => s.detail || `${SOURCE_LABELS[s.source]} not scanned`).join(" · ");
}

// useLocalScan scans this machine once when shown and on request.
function useLocalScan(): { state: ScanState; scan: () => void } {
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
  return { state, scan: () => void scan() };
}

// DiscoverLocalPanel lists the databases running on this machine as connection cards.
export function DiscoverLocalPanel({ onPick, saved = [], onOpenSaved, columns = 2 }: DiscoverLocalPanelProps) {
  const { state, scan } = useLocalScan();
  const controls = (
    <>
      {state.status === "ready" ? <span>{sourceLine(state.result.sources)}</span> : null}
      <Button size="sm" variant="ghost" className="h-7 gap-1.5 px-2" onClick={scan} disabled={state.status === "loading"}>
        <RefreshCw className="size-3.5" aria-hidden /> Rescan
      </Button>
    </>
  );
  return (
    <FoundGroup icon={Laptop} title="On this machine" controls={controls}>
      {state.status === "loading" ? <FoundSkeleton columns={columns} label="Scanning this machine…" /> : null}
      {state.status === "error" ? (
        <FoundNotice tone="error" action={<Button size="sm" variant="outline" onClick={scan}>Try again</Button>}>
          Could not scan this machine: {state.message}
        </FoundNotice>
      ) : null}
      {state.status === "ready" && state.result.candidates.length === 0 ? (
        <FoundNotice>No database is running on the usual ports here, and no Docker container exposes one.</FoundNotice>
      ) : null}
      {state.status === "ready" && state.result.candidates.length > 0 ? (
        <div className={foundGridClass(columns)}>
          {state.result.candidates.map((c) => {
            const match = savedForEndpoint(saved, c.host, c.port);
            const open = match && onOpenSaved ? () => onOpenSaved(match.id) : () => onPick(candidateConnectionString(c));
            return <FoundDatabaseCard key={`${c.host}:${c.port}`} found={{ kind: "local", candidate: c }} saved={Boolean(match && onOpenSaved)} onActivate={open} />;
          })}
        </div>
      ) : null}
    </FoundGroup>
  );
}
