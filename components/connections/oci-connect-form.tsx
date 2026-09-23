"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { ArrowLeft, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { CardBadge, CONNECTION_CARD_CLASS, ConnectionCardHeader, ProviderMark } from "@/components/connections/connection-card";
import { ociConnect, ociRoute, saveConnection } from "@/lib/api/discover-client";
import type { OciDatabaseSummary, OciRouteAnswer } from "@/lib/oci/oci-database";
import { cn } from "@/lib/utils";

/** Where the form is between naming a database and saving its connection. */
type Step = { status: "resolving" } | { status: "error"; message: string } | { status: "ready"; answer: OciRouteAnswer } | { status: "connecting" };

/** What the form needs to know. */
type FormProps = { profile: string; database: OciDatabaseSummary; onBack: () => void; onSaved: () => void };

/** How each service reads on the card, with the logo it uses. */
const KIND_VIEW: Record<OciDatabaseSummary["kind"], { label: string; logo: string }> = {
  mysql: { label: "MySQL HeatWave", logo: "mysql" },
  postgres: { label: "OCI PostgreSQL", logo: "postgres" },
  autonomous: { label: "Autonomous Database", logo: "jdbc" },
};

// connectionTypeFor maps the cloud engine to the studio's provider id.
function connectionTypeFor(engine: string): string {
  return engine === "mysql" ? "mysql" : "postgresql";
}

// useRoute works out, once, how the database will be reached, and prefills the login it suggests.
function useRoute(profile: string, database: OciDatabaseSummary, prefill: (answer: OciRouteAnswer) => void) {
  const [step, setStep] = useState<Step>({ status: "resolving" });
  const resolve = useCallback(async () => {
    setStep({ status: "resolving" });
    try {
      const answer = await ociRoute(profile, database);
      prefill(answer);
      setStep({ status: "ready", answer });
    } catch (e) {
      setStep({ status: "error", message: (e as Error).message });
    }
  }, [profile, database, prefill]);
  useEffect(() => void resolve(), [resolve]);
  return { step, setStep, resolve };
}

// OciConnectForm is the found database's card opened up: how it is reached, then only its login.
export function OciConnectForm({ profile, database, onBack, onSaved }: FormProps) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [dbName, setDbName] = useState("");
  const [saveError, setSaveError] = useState<string | null>(null);
  const prefill = useCallback((answer: OciRouteAnswer) => {
    setUsername((u) => u || answer.target.adminUser);
    setDbName((d) => d || answer.target.dbName);
  }, []);
  const { step, setStep, resolve } = useRoute(profile, database, prefill);
  const view = KIND_VIEW[database.kind];

  const submit = useCallback(async (event: FormEvent) => {
    event.preventDefault();
    if (step.status !== "ready") return;
    const ready = step;
    setStep({ status: "connecting" });
    setSaveError(null);
    try {
      const route = await ociConnect({ profile, database, login: { username, password, database: dbName } });
      await saveConnection({ name: database.name, connectionString: route.connectionString, connectionType: connectionTypeFor(route.target.engine) });
      onSaved();
    } catch (e) {
      setSaveError((e as Error).message);
      setStep(ready);
    }
  }, [step, setStep, profile, database, username, password, dbName, onSaved]);

  return (
    <div className="space-y-3">
      <button type="button" onClick={onBack} className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-3.5" aria-hidden /> All databases
      </button>
      <div className={cn(CONNECTION_CARD_CLASS, "hover:border-studio-border/60 hover:bg-card")}>
        <ConnectionCardHeader logo={<ProviderMark provider={view.logo} label={view.label} />} title={database.name} subtitle={view.label} actions={<CardBadge>Oracle Cloud</CardBadge>} />
        <RouteNote step={step} onRetry={() => void resolve()} />
        {step.status === "ready" || step.status === "connecting" ? (
          <form onSubmit={submit} className="mt-4 space-y-3">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field id="oci-user" label="User" value={username} onChange={setUsername} />
              <Field id="oci-password" label="Password" value={password} onChange={setPassword} secret />
            </div>
            <Field id="oci-db" label="Database (optional)" value={dbName} onChange={setDbName} optional />
            {saveError ? <p role="alert" className="text-sm text-destructive">{saveError}</p> : null}
            <Button type="submit" size="sm" className="gap-1.5" disabled={step.status === "connecting"}>
              <ShieldCheck className="size-3.5" aria-hidden /> {step.status === "connecting" ? "Saving…" : "Connect"}
            </Button>
          </form>
        ) : null}
      </div>
    </div>
  );
}

/** One labelled input of the login. */
type FieldProps = { id: string; label: string; value: string; onChange: (v: string) => void; secret?: boolean; optional?: boolean };

// Field is one labelled login input.
function Field({ id, label, value, onChange, secret, optional }: FieldProps) {
  return (
    <div className="space-y-1">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} type={secret ? "password" : "text"} value={value} onChange={(e) => onChange(e.target.value)} autoComplete={secret ? "new-password" : "off"} required={!optional} />
    </div>
  );
}

// RouteNote says how the database will be reached, or why it cannot be.
function RouteNote({ step, onRetry }: { step: Step; onRetry: () => void }) {
  if (step.status === "resolving") return <Skeleton className="h-10 w-full rounded-md" />;
  if (step.status === "connecting") return <p className="text-xs text-muted-foreground">Saving the connection. Opening it starts the relay in your cluster.</p>;
  if (step.status === "error") {
    return (
      <div className="space-y-2">
        <p className="text-xs text-destructive">{step.message}</p>
        <Button size="sm" variant="outline" onClick={onRetry}>Try again</Button>
      </div>
    );
  }
  const { target, cluster } = step.answer;
  if (!cluster) return <p className="text-xs text-muted-foreground">{target.name} answers only on {target.privateIp}:{target.port}, and none of your clusters sits in that network, so there is no way in that leaves Oracle Cloud untouched.</p>;
  return (
    <p className="text-xs text-muted-foreground">
      {target.engine} {target.version} at {target.privateIp}:{target.port}, reached through your cluster {cluster.name} with one short-lived relay, encrypted end to end. Nothing is created in Oracle Cloud. Any database user works, not only the admin.
    </p>
  );
}
