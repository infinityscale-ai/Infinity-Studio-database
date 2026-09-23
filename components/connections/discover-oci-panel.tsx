"use client";

import { useCallback, useEffect, useState } from "react";
import { Cloud, LogIn, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { DiscoverApiError, ociDatabases, ociLogin, ociStatus } from "@/lib/api/discover-client";
import type { OciDatabaseSummary, OciProfileStatus, OciStatus } from "@/lib/oci/oci-database";
import { OciConnectForm } from "@/components/connections/oci-connect-form";

/** What the panel knows about the machine and the chosen profile. */
type PanelState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; oci: OciStatus; profile: OciProfileStatus | null };

/** The database list for the chosen profile. */
type ListState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "signing-in" }
  | { status: "error"; message: string; expired: boolean }
  | { status: "ready"; databases: OciDatabaseSummary[] };

/** How each kind reads in the list. */
const KIND_LABELS: Record<OciDatabaseSummary["kind"], string> = { mysql: "MySQL HeatWave", postgres: "OCI PostgreSQL", autonomous: "Autonomous Database" };

// NotInstalled explains how to get the CLI the panel depends on.
function NotInstalled() {
  return (
    <div className="space-y-2 text-sm">
      <p>The OCI command-line tool is not installed on this machine, so the studio cannot use your Oracle Cloud sign-in.</p>
      <p className="text-muted-foreground">
        Install it and sign in once with <code className="font-mono text-xs">oci session authenticate</code>, then come back here.
      </p>
    </div>
  );
}

// ProfilePicker lists the profiles of ~/.oci/config with their session state.
function ProfilePicker({ profiles, value, onChange }: { profiles: OciProfileStatus[]; value: string; onChange: (name: string) => void }) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <span className="text-muted-foreground">Profile</span>
      <select className="h-8 rounded-md border border-studio-border bg-background px-2 text-sm" value={value} onChange={(e) => onChange(e.target.value)}>
        {profiles.map((p) => (
          <option key={p.name} value={p.name}>
            {p.name} · {p.region}{p.sessionValid === false ? " · signed out" : ""}
          </option>
        ))}
      </select>
    </label>
  );
}

// DatabaseRow shows one cloud database and the button that starts its connection.
function DatabaseRow({ db, onConnect }: { db: OciDatabaseSummary; onConnect: () => void }) {
  return (
    <li className="flex items-center gap-3 rounded-lg border border-studio-border/60 bg-studio-bg/60 px-3 py-2">
      <Cloud className="size-4 shrink-0 text-muted-foreground" aria-hidden />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">{db.name}</div>
        <div className="truncate text-xs text-muted-foreground">{KIND_LABELS[db.kind]} · {db.state.toLowerCase()}</div>
      </div>
      <Button size="sm" variant="outline" onClick={onConnect} disabled={db.state !== "ACTIVE"}>
        Connect
      </Button>
    </li>
  );
}

// DiscoverOciPanel signs the user in with their local OCI CLI, lists their databases and opens one through a bastion.
export function DiscoverOciPanel({ onSaved }: { onSaved: () => void }) {
  const [panel, setPanel] = useState<PanelState>({ status: "loading" });
  const [list, setList] = useState<ListState>({ status: "idle" });
  const [chosen, setChosen] = useState<OciDatabaseSummary | null>(null);

  const loadStatus = useCallback(async () => {
    setPanel({ status: "loading" });
    try {
      const oci = await ociStatus();
      setPanel({ status: "ready", oci, profile: oci.profiles[0] ?? null });
    } catch (e) {
      setPanel({ status: "error", message: (e as Error).message });
    }
  }, []);
  useEffect(() => void loadStatus(), [loadStatus]);

  const loadDatabases = useCallback(async (profile: string) => {
    setList({ status: "loading" });
    try {
      setList({ status: "ready", databases: await ociDatabases(profile) });
    } catch (e) {
      const expired = e instanceof DiscoverApiError && e.status === 401;
      setList({ status: "error", message: (e as Error).message, expired });
    }
  }, []);

  const signIn = useCallback(async (profile: string) => {
    setList({ status: "signing-in" });
    try {
      await ociLogin(profile);
      await loadDatabases(profile);
    } catch (e) {
      setList({ status: "error", message: (e as Error).message, expired: true });
    }
  }, [loadDatabases]);

  useEffect(() => {
    if (panel.status !== "ready" || !panel.profile) return;
    if (panel.profile.sessionValid === false) setList({ status: "error", message: "This profile's session has expired.", expired: true });
    else void loadDatabases(panel.profile.name);
  }, [panel, loadDatabases]);

  if (panel.status === "loading") return <Skeleton className="h-24 w-full rounded-lg" />;
  if (panel.status === "error") return <p className="text-sm text-destructive">Could not read the OCI setup: {panel.message}</p>;
  if (!panel.oci.installed) return <NotInstalled />;
  if (!panel.profile) return <p className="text-sm text-muted-foreground">No profile in ~/.oci/config yet. Run <code className="font-mono text-xs">oci session authenticate</code> once, then rescan.</p>;
  const profile = panel.profile;
  if (chosen) return <OciConnectForm profile={profile.name} database={chosen} onBack={() => setChosen(null)} onSaved={onSaved} />;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <ProfilePicker profiles={panel.oci.profiles} value={profile.name} onChange={(name) => setPanel({ ...panel, profile: panel.oci.profiles.find((p) => p.name === name) ?? null })} />
        <Button size="sm" variant="ghost" className="gap-1.5" onClick={() => void loadDatabases(profile.name)} disabled={list.status === "loading"}>
          <RefreshCw className="size-3.5" aria-hidden /> Refresh
        </Button>
      </div>
      <DatabaseList list={list} onSignIn={() => void signIn(profile.name)} onConnect={setChosen} />
      {profile.validUntil && <p className="text-xs text-muted-foreground">Signed in until {profile.validUntil}.</p>}
    </div>
  );
}

// DatabaseList renders the list's states: loading, signing in, expired, error, empty and ready.
function DatabaseList({ list, onSignIn, onConnect }: { list: ListState; onSignIn: () => void; onConnect: (db: OciDatabaseSummary) => void }) {
  if (list.status === "idle" || list.status === "loading") return <Skeleton className="h-24 w-full rounded-lg" />;
  if (list.status === "signing-in") return <p className="text-sm text-muted-foreground">Finish signing in to Oracle Cloud in the browser window that just opened…</p>;
  if (list.status === "error") {
    return (
      <div className="space-y-3 text-sm">
        <p className={list.expired ? "text-muted-foreground" : "text-destructive"}>{list.message}</p>
        {list.expired && (
          <Button size="sm" variant="outline" className="gap-1.5" onClick={onSignIn}>
            <LogIn className="size-3.5" aria-hidden /> Sign in to Oracle Cloud
          </Button>
        )}
      </div>
    );
  }
  if (list.databases.length === 0) return <p className="rounded-lg border border-dashed border-studio-border/60 px-3 py-6 text-center text-sm text-muted-foreground">No MySQL, PostgreSQL or Autonomous database in this tenancy and region.</p>;
  return <ul className="max-h-72 space-y-2 overflow-y-auto">{list.databases.map((db) => <DatabaseRow key={db.id} db={db} onConnect={() => onConnect(db)} />)}</ul>;
}
