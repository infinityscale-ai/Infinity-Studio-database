"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { ArrowLeft, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { DiscoverApiError, ociBastion, ociConnect, saveConnection } from "@/lib/api/discover-client";
import type { OciBastionAnswer, OciDatabaseSummary } from "@/lib/oci/oci-database";

/** Where the form is in the bastion-then-session flow. */
type Step =
  | { status: "resolving" }
  | { status: "error"; message: string }
  | { status: "no-private-endpoint"; message: string }
  | { status: "needs-bastion"; answer: OciBastionAnswer }
  | { status: "creating-bastion" }
  | { status: "ready"; answer: OciBastionAnswer }
  | { status: "connecting" };

/** What the form needs to know. */
type FormProps = { profile: string; database: OciDatabaseSummary; onBack: () => void; onSaved: () => void };

// connectionTypeFor maps the cloud engine to the studio's provider id.
function connectionTypeFor(engine: string): string {
  return engine === "mysql" ? "mysql" : "postgresql";
}

// OciConnectForm resolves the bastion for one database, asks only for the database login, and saves the tunneled connection.
export function OciConnectForm({ profile, database, onBack, onSaved }: FormProps) {
  const [step, setStep] = useState<Step>({ status: "resolving" });
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [dbName, setDbName] = useState("");
  const [saveError, setSaveError] = useState<string | null>(null);

  const resolve = useCallback(async (create: boolean) => {
    setStep(create ? { status: "creating-bastion" } : { status: "resolving" });
    try {
      const answer = await ociBastion(profile, database, create);
      setUsername((u) => u || answer.target.adminUser);
      setDbName((d) => d || answer.target.dbName);
      setStep(answer.bastion ? { status: "ready", answer } : { status: "needs-bastion", answer });
    } catch (e) {
      const code = e instanceof DiscoverApiError ? e.code : "";
      setStep(code === "oci_no_private_endpoint" ? { status: "no-private-endpoint", message: (e as Error).message } : { status: "error", message: (e as Error).message });
    }
  }, [profile, database]);
  useEffect(() => void resolve(false), [resolve]);

  const submit = useCallback(async (event: FormEvent) => {
    event.preventDefault();
    if (step.status !== "ready") return;
    const ready = step;
    setStep({ status: "connecting" });
    setSaveError(null);
    try {
      const tunnel = await ociConnect({ profile, database, login: { username, password, database: dbName } });
      await saveConnection({ name: `${database.name} (OCI)`, connectionString: tunnel.connectionString, connectionType: connectionTypeFor(tunnel.target.engine) });
      onSaved();
    } catch (e) {
      setSaveError((e as Error).message);
      setStep(ready);
    }
  }, [step, profile, database, username, password, dbName, onSaved]);

  return (
    <div className="space-y-4">
      <button type="button" onClick={onBack} className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-3.5" aria-hidden /> All databases
      </button>
      <div>
        <div className="text-sm font-medium">{database.name}</div>
        <StepNote step={step} onCreate={() => void resolve(true)} onRetry={() => void resolve(false)} />
      </div>
      {(step.status === "ready" || step.status === "connecting") && (
        <form onSubmit={submit} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="oci-user">Database user</Label>
              <Input id="oci-user" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="off" required />
            </div>
            <div className="space-y-1">
              <Label htmlFor="oci-password">Password</Label>
              <Input id="oci-password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" required />
            </div>
          </div>
          <div className="space-y-1">
            <Label htmlFor="oci-db">Database name <span className="text-muted-foreground">(optional)</span></Label>
            <Input id="oci-db" value={dbName} onChange={(e) => setDbName(e.target.value)} autoComplete="off" />
          </div>
          {saveError && <p className="text-sm text-destructive">{saveError}</p>}
          <Button type="submit" size="sm" className="gap-1.5" disabled={step.status === "connecting"}>
            <ShieldCheck className="size-3.5" aria-hidden /> {step.status === "connecting" ? "Opening the bastion session…" : "Connect through the bastion"}
          </Button>
        </form>
      )}
    </div>
  );
}

// StepNote says where the flow stands and offers the one action each state allows.
function StepNote({ step, onCreate, onRetry }: { step: Step; onCreate: () => void; onRetry: () => void }) {
  if (step.status === "resolving") return <Skeleton className="mt-2 h-10 w-full rounded-md" />;
  if (step.status === "creating-bastion") return <p className="mt-1 text-xs text-muted-foreground">Creating a bastion in the database&apos;s network. This takes a minute or two…</p>;
  if (step.status === "connecting") return <p className="mt-1 text-xs text-muted-foreground">Opening a port-forwarding session; the database stays private.</p>;
  if (step.status === "no-private-endpoint") return <p className="mt-1 text-xs text-muted-foreground">{step.message}</p>;
  if (step.status === "error") {
    return (
      <div className="mt-1 space-y-2">
        <p className="text-xs text-destructive">{step.message}</p>
        <Button size="sm" variant="outline" onClick={onRetry}>Try again</Button>
      </div>
    );
  }
  if (step.status === "needs-bastion") {
    const t = step.answer.target;
    return (
      <div className="mt-1 space-y-2">
        <p className="text-xs text-muted-foreground">
          {t.name} answers only on the private address {t.privateIp}:{t.port}, so the studio needs a way into the network it already lives in.
          A bastion is a free Oracle service placed inside that same network: it forwards this one port to the studio for up to three hours and creates nothing else.
          One bastion serves every database in the network, and one connection opens every schema in this system.
        </p>
        <Button size="sm" variant="outline" onClick={onCreate}>Add a bastion to this network</Button>
      </div>
    );
  }
  const t = step.answer.target;
  return <p className="mt-1 text-xs text-muted-foreground">{t.engine} {t.version} at {t.privateIp}:{t.port} through bastion {step.answer.bastion?.name}. Only the database login is needed.</p>;
}
