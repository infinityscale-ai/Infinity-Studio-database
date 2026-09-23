"use client";

import { useCallback, useEffect, useState } from "react";
import { Cloud, LogIn, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FoundDatabaseCard } from "@/components/connections/found-database-card";
import { FoundGroup, FoundNotice, FoundSkeleton, foundGridClass, type FoundColumns } from "@/components/connections/found-group";
import { OciConnectForm } from "@/components/connections/oci-connect-form";
import { OciSessionDialog } from "@/components/connections/oci-session-dialog";
import { DiscoverApiError, ociDatabases, ociStatus } from "@/lib/api/discover-client";
import { savedForOciDatabase, type SavedLike } from "@/lib/discovery/saved-match";
import type { OciDatabaseSummary, OciProfileStatus, OciStatus } from "@/lib/oci/oci-database";

/** What the Oracle Cloud group needs: how to report a saved connection, and the saved list to recognise one. */
export type DiscoverOciPanelProps = { onSaved: () => void; saved?: SavedLike[]; onOpenSaved?: (id: number) => void; columns?: FoundColumns };

/** The sign-in this machine has, once read. */
type StatusState = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; oci: OciStatus };

/** The databases of the chosen profile. */
type ListState = { status: "loading" } | { status: "expired" } | { status: "error"; message: string } | { status: "ready"; databases: OciDatabaseSummary[] };

// useOciStatus reads the sign-in files once and on request.
function useOciStatus(): { state: StatusState; reload: () => void } {
  const [state, setState] = useState<StatusState>({ status: "loading" });
  const reload = useCallback(async () => {
    setState({ status: "loading" });
    try {
      setState({ status: "ready", oci: await ociStatus() });
    } catch (e) {
      setState({ status: "error", message: (e as Error).message });
    }
  }, []);
  useEffect(() => void reload(), [reload]);
  return { state, reload: () => void reload() };
}

// useOciDatabases lists the profile's databases whenever the profile or its sign-in changes.
function useOciDatabases(profile: OciProfileStatus | null): { list: ListState; reload: () => void } {
  const [list, setList] = useState<ListState>({ status: "loading" });
  const reload = useCallback(async () => {
    if (!profile) return;
    if (profile.sessionValid === false) return setList({ status: "expired" });
    setList({ status: "loading" });
    try {
      setList({ status: "ready", databases: await ociDatabases(profile.name) });
    } catch (e) {
      setList(e instanceof DiscoverApiError && e.status === 401 ? { status: "expired" } : { status: "error", message: (e as Error).message });
    }
  }, [profile]);
  useEffect(() => void reload(), [reload]);
  return { list, reload: () => void reload() };
}

// ProfileControls shows which sign-in is used, until when, and lets the user refresh the list.
function ProfileControls({ oci, profile, onProfile, onRefresh }: { oci: OciStatus; profile: OciProfileStatus; onProfile: (name: string) => void; onRefresh: () => void }) {
  return (
    <>
      {oci.profiles.length > 1 ? (
        <select aria-label="Oracle Cloud profile" className="h-7 rounded-md border border-studio-border bg-background px-2 text-xs" value={profile.name} onChange={(e) => onProfile(e.target.value)}>
          {oci.profiles.map((p) => <option key={p.name} value={p.name}>{p.name} · {p.region}</option>)}
        </select>
      ) : (
        <span>{profile.name} · {profile.region}</span>
      )}
      {profile.validUntil && profile.sessionValid !== false ? <span>signed in until {profile.validUntil}</span> : null}
      <Button size="sm" variant="ghost" className="h-7 gap-1.5 px-2" onClick={onRefresh}>
        <RefreshCw className="size-3.5" aria-hidden /> Refresh
      </Button>
    </>
  );
}

/** What the card grid needs to draw every list state. */
type OciCardsProps = { list: ListState; columns: FoundColumns; saved: SavedLike[]; onOpenSaved?: (id: number) => void; onChoose: (db: OciDatabaseSummary) => void; onSignIn: () => void };

// OciCards draws the list's states: loading, signed out, error, empty and the cards.
function OciCards({ list, columns, saved, onOpenSaved, onChoose, onSignIn }: OciCardsProps) {
  if (list.status === "loading") return <FoundSkeleton columns={columns} label="Listing your Oracle Cloud databases…" />;
  if (list.status === "expired") {
    return <FoundNotice action={<Button size="sm" variant="outline" className="gap-1.5" onClick={onSignIn}><LogIn className="size-3.5" aria-hidden /> Sign in to Oracle Cloud</Button>}>Your Oracle Cloud sign-in has expired.</FoundNotice>;
  }
  if (list.status === "error") return <FoundNotice tone="error">{list.message}</FoundNotice>;
  if (list.databases.length === 0) return <FoundNotice>No MySQL, PostgreSQL or Autonomous database in this tenancy and region.</FoundNotice>;
  return (
    <div className={foundGridClass(columns)}>
      {list.databases.map((db) => {
        const match = savedForOciDatabase(saved, db.id);
        const open = match && onOpenSaved ? () => onOpenSaved(match.id) : () => onChoose(db);
        return <FoundDatabaseCard key={db.id} found={{ kind: "cloud", database: db }} saved={Boolean(match && onOpenSaved)} onActivate={open} />;
      })}
    </div>
  );
}

// DiscoverOciPanel lists the tenancy's databases as connection cards, using the Oracle Cloud sign-in kept in ~/.oci.
export function DiscoverOciPanel({ onSaved, saved = [], onOpenSaved, columns = 2 }: DiscoverOciPanelProps) {
  const { state, reload } = useOciStatus();
  const [profileName, setProfileName] = useState<string | null>(null);
  const [chosen, setChosen] = useState<OciDatabaseSummary | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const oci = state.status === "ready" ? state.oci : null;
  const profile = oci ? (oci.profiles.find((p) => p.name === profileName) ?? oci.profiles[0] ?? null) : null;
  const { list, reload: reloadList } = useOciDatabases(profile);
  useEffect(() => {
    if (list.status === "expired") setDialogOpen(true);
  }, [list.status]);

  if (state.status === "loading") return <FoundGroup icon={Cloud} title="Oracle Cloud"><FoundSkeleton columns={columns} label="Reading your Oracle Cloud sign-in…" /></FoundGroup>;
  if (state.status === "error") return <FoundGroup icon={Cloud} title="Oracle Cloud"><FoundNotice tone="error">Could not read the Oracle Cloud sign-in: {state.message}</FoundNotice></FoundGroup>;
  if (!oci?.configured || !profile) return <FoundGroup icon={Cloud} title="Oracle Cloud"><NoSignIn onCheckAgain={reload} /></FoundGroup>;
  const controls = chosen ? null : <ProfileControls oci={oci} profile={profile} onProfile={setProfileName} onRefresh={reloadList} />;
  return (
    <FoundGroup icon={Cloud} title="Oracle Cloud" controls={controls}>
      <OciSessionDialog open={dialogOpen} profile={profile} cliAvailable={oci.cliAvailable} onOpenChange={setDialogOpen} onRefreshed={reload} />
      {chosen ? (
        <OciConnectForm profile={profile.name} database={chosen} onBack={() => setChosen(null)} onSaved={onSaved} />
      ) : (
        <OciCards list={list} columns={columns} saved={saved} onOpenSaved={onOpenSaved} onChoose={setChosen} onSignIn={() => setDialogOpen(true)} />
      )}
    </FoundGroup>
  );
}

// NoSignIn says where the studio looks for an Oracle Cloud sign-in and how to create one.
function NoSignIn({ onCheckAgain }: { onCheckAgain: () => void }) {
  return (
    <FoundNotice action={<Button size="sm" variant="outline" className="gap-1.5" onClick={onCheckAgain}><RefreshCw className="size-3.5" aria-hidden /> Check again</Button>}>
      No Oracle Cloud sign-in on this computer yet. Run <code className="font-mono text-xs">oci session authenticate</code> once, then check again.
    </FoundNotice>
  );
}
