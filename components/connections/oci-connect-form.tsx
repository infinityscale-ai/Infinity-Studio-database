"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { ArrowLeft, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { DiscoverApiError, ociConnect, ociRoute, saveConnection } from "@/lib/api/discover-client";
import type { OciDatabaseSummary, OciRouteAnswer } from "@/lib/oci/oci-database";

/** Where the form is between naming a database and saving its connection. */
type Step =
  | { status: "resolving" }
  | { status: "error"; message: string }
  | { status: "ready"; answer: OciRouteAnswer }
  | { status: "connecting" };

/** What the form needs to know. */
type FormProps = { profile: string; database: OciDatabaseSummary; onBack: () => void; onSaved: () => void };

// connectionTypeFor maps the cloud engine to the studio's provider id.
function connectionTypeFor(engine: string): string {
  return engine === "mysql" ? "mysql" : "postgresql";
}

// OciConnectForm shows how a database will be reached, takes its master login, and saves the connection.
export function OciConnectForm({ profile, database, onBack, onSaved }: FormProps) {
  const [step, setStep] = useState<Step>({ status: "resolving" });
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [dbName, setDbName] = useState("");
  const [namespace, setNamespace] = useState("default");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const resolve = useCallback(async () => {
    setStep({ status: "resolving" });
    try {
      const answer = await ociRoute(profile, database);
      setUsername((u) => u || answer.target.adminUser);
      setDbName((d) => d || answer.target.dbName);
      setStep({ status: "ready", answer });
    } catch (e) {
      setStep({ status: "error", message: (e as Error).message });
    }
  }, [profile, database]);
  useEffect(() => void resolve(), [resolve]);

  const submit = useCallback(async (event: FormEvent) => {
    event.preventDefault();
    if (step.status !== "ready") return;
    const ready = step;
    setStep({ status: "connecting" });
    setSaveError(null);
    try {
      const route = await ociConnect({ profile, database, login: { username, password, database: dbName }, namespace });
      await saveConnection({ name: `${database.name} (Oracle Cloud)`, connectionString: route.connectionString, connectionType: connectionTypeFor(route.target.engine) });
      onSaved();
    } catch (e) {
      setSaveError((e as DiscoverApiError).message);
      setStep(ready);
    }
  }, [step, profile, database, username, password, dbName, namespace, onSaved]);

  return (
    <div className="space-y-4">
      <button type="button" onClick={onBack} className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-3.5" aria-hidden /> All databases
      </button>
      <div>
        <div className="text-sm font-medium">{database.name}</div>
        <RouteNote step={step} onRetry={() => void resolve()} />
      </div>
      {(step.status === "ready" || step.status === "connecting") && (
        <form onSubmit={submit} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="oci-user">Master user</Label>
              <Input id="oci-user" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="off" required />
            </div>
            <div className="space-y-1">
              <Label htmlFor="oci-password">Master password</Label>
              <Input id="oci-password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" required />
            </div>
          </div>
          <div className="space-y-1">
            <Label htmlFor="oci-db">Database name <span className="text-muted-foreground">(optional)</span></Label>
            <Input id="oci-db" value={dbName} onChange={(e) => setDbName(e.target.value)} autoComplete="off" />
          </div>
          {showAdvanced ? (
            <div className="space-y-1">
              <Label htmlFor="oci-ns">Cluster namespace</Label>
              <Input id="oci-ns" value={namespace} onChange={(e) => setNamespace(e.target.value)} autoComplete="off" placeholder="default" />
            </div>
          ) : (
            <div>
              <button type="button" onClick={() => setShowAdvanced(true)} className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline">
                Change the cluster namespace
              </button>
            </div>
          )}
          {saveError && <p className="text-sm text-destructive">{saveError}</p>}
          <Button type="submit" size="sm" className="gap-1.5" disabled={step.status === "connecting"}>
            <ShieldCheck className="size-3.5" aria-hidden /> {step.status === "connecting" ? "Saving…" : "Connect"}
          </Button>
        </form>
      )}
    </div>
  );
}

// RouteNote says how the database will be reached, or why it cannot be.
function RouteNote({ step, onRetry }: { step: Step; onRetry: () => void }) {
  if (step.status === "resolving") return <Skeleton className="mt-2 h-10 w-full rounded-md" />;
  if (step.status === "connecting") return <p className="mt-1 text-xs text-muted-foreground">Saving the connection. Opening it starts the relay in your cluster.</p>;
  if (step.status === "error") {
    return (
      <div className="mt-1 space-y-2">
        <p className="text-xs text-destructive">{step.message}</p>
        <Button size="sm" variant="outline" onClick={onRetry}>Try again</Button>
      </div>
    );
  }
  const { target, cluster } = step.answer;
  if (!cluster) {
    return (
      <p className="mt-1 text-xs text-muted-foreground">
        {target.name} answers only on {target.privateIp}:{target.port}, and none of your Kubernetes clusters sits in that network. The studio has no way in that leaves Oracle Cloud untouched.
      </p>
    );
  }
  return (
    <p className="mt-1 text-xs text-muted-foreground">
      {target.engine} {target.version} on the private address {target.privateIp}:{target.port}.
      The studio reaches it through your own cluster {cluster.name}: one small relay pod, started when you open the connection and removed when you close it.
      Nothing is created in Oracle Cloud, and none of your manifests change.
    </p>
  );
}
