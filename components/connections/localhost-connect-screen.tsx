"use client";

import { useEffect, useState, type FormEvent } from "react";
import { ArrowLeft, Laptop, PlugZap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { CheckResult, EngineToggle, FormField } from "@/components/connections/connection-form-parts";
import { useLocalTools } from "@/components/connections/use-local-tools";
import { useLocalhostConnect, valuesFrom, type LocalhostEngine, type LocalhostValues } from "@/components/connections/use-localhost-connect";
import { discoverLocal } from "@/lib/api/discover-client";
import { autoAddName } from "@/lib/discovery/auto-add";
import type { DatabaseCandidate } from "@/lib/discovery/database-candidate";

/** What the screen needs: the way back, and what to do once the connection is saved. */
export type LocalhostConnectScreenProps = { onBack: () => void; onSaved: () => void };

/** The engines a local database can be typed in as. */
const ENGINES: Array<{ id: LocalhostEngine; label: string }> = [
  { id: "mysql", label: "MySQL" },
  { id: "mariadb", label: "MariaDB" },
  { id: "postgres", label: "PostgreSQL" },
  { id: "mongodb", label: "MongoDB" },
  { id: "redis", label: "Redis" },
];

// useFoundDatabases scans this computer once, for the fill-in shortcuts; a failed scan just shows none.
function useFoundDatabases(): DatabaseCandidate[] {
  const [found, setFound] = useState<DatabaseCandidate[]>([]);
  useEffect(() => {
    void discoverLocal().then((r) => setFound(r.candidates), () => setFound([]));
  }, []);
  return found;
}

// FillFrom offers each database found on this computer as a one-click fill of the form.
function FillFrom({ onFill }: { onFill: (v: LocalhostValues) => void }) {
  const found = useFoundDatabases().map((c) => ({ c, v: valuesFrom(c) })).filter((x) => x.v !== null);
  if (found.length === 0) return null;
  return (
    <div className="space-y-1.5">
      <p className="text-xs text-muted-foreground">Found on this computer, click to fill:</p>
      <div className="flex flex-wrap gap-1.5">
        {found.map(({ c, v }) => (
          <Button key={`${c.host}:${c.port}`} type="button" size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => onFill(v as LocalhostValues)}>
            {autoAddName(c)}
          </Button>
        ))}
      </div>
    </div>
  );
}

// LocalhostForm is the typed-in local database: engine, address, optional login, then test or save.
function LocalhostForm({ host, onSaved }: { host: string; onSaved: () => void }) {
  const { values, set, fill, check, test, save } = useLocalhostConnect(host, onSaved);
  const busy = check.status === "working";
  const field = (id: keyof LocalhostValues) => ({ id: `local-${id}`, value: values[id], onChange: (v: string) => set(id, v) });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    save();
  };
  return (
    <form onSubmit={submit}>
      <Card className="space-y-4 border-studio-border/60 bg-studio-bg/80 p-5">
        <FillFrom onFill={fill} />
        <EngineToggle options={ENGINES} value={values.engine} onChange={(id) => set("engine", id)} />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-[1fr_8rem]">
          <FormField label="Host" {...field("host")} />
          <FormField label="Port" {...field("port")} />
        </div>
        <FormField label="Database (optional)" optional {...field("database")} />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormField label="User (optional)" optional {...field("username")} />
          <FormField label="Password (optional)" secret optional {...field("password")} />
        </div>
        <FormField label="Name (optional)" optional {...field("name")} />
        <CheckResult check={check} />
        <div className="flex flex-wrap justify-end gap-2">
          <Button type="button" variant="outline" disabled={busy} onClick={test} className="gap-1.5">
            <PlugZap className="size-4" aria-hidden /> Test connection
          </Button>
          <Button type="submit" disabled={busy}>{busy && check.saving ? "Saving…" : "Save connection"}</Button>
        </div>
      </Card>
    </form>
  );
}

// LocalhostConnectScreen adds a database running on this computer; no login is asked unless the database needs one.
export function LocalhostConnectScreen({ onBack, onSaved }: LocalhostConnectScreenProps) {
  const tools = useLocalTools();
  return (
    <div className="h-full w-full overflow-y-auto scrollbar-hide py-6">
      <div className="mx-auto w-full max-w-2xl space-y-4 px-4">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" className="h-8 w-8 rounded-lg text-muted-foreground hover:text-foreground" onClick={onBack} aria-label="Back to Add Connection">
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <Laptop className="size-4 text-muted-foreground" aria-hidden />
          <h2 className="text-sm font-semibold">Localhost database</h2>
        </div>
        <p className="text-sm text-muted-foreground">
          A database on this computer. Leave the login empty if it has none; the studio asks only when the database refuses.
        </p>
        {tools ? <LocalhostForm host={tools.hostAlias} onSaved={onSaved} /> : <Skeleton className="h-96 w-full rounded-xl" />}
      </div>
    </div>
  );
}
