"use client";

import type { FormEvent } from "react";
import { ArrowLeft, Cloud, PlugZap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { CheckResult, EngineToggle, FormField } from "@/components/connections/connection-form-parts";
import { useOracleCloudConnect, type OracleCloudEngine, type OracleCloudValues } from "@/components/connections/use-oracle-cloud-connect";

/** What the screen needs: the way back, and what to do once the connection is saved. */
export type OracleCloudConnectScreenProps = { onBack: () => void; onSaved: () => void };

/** A connection string that marks failures as cluster-routed, so a refused login is explained as "the route worked". */
const ROUTED_MARKER = "mysql://oracle-cloud/?infstudio_k8s_mode=k8s";

/** The two engines, as the toggle shows them. */
const ENGINES: Array<{ id: OracleCloudEngine; label: string }> = [
  { id: "mysql", label: "MySQL HeatWave" },
  { id: "postgres", label: "OCI PostgreSQL" },
];

// OracleCloudConnectScreen adds an Oracle Cloud database the way an app's .env names it, checked through the user's own cluster.
export function OracleCloudConnectScreen({ onBack, onSaved }: OracleCloudConnectScreenProps) {
  const { values, set, check, test, save } = useOracleCloudConnect(onSaved);
  const busy = check.status === "working";
  const field = (id: keyof OracleCloudValues) => ({ id: `oci-${id}`, value: values[id], onChange: (v: string) => set(id, v) });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    save();
  };
  return (
    <div className="h-full w-full overflow-y-auto scrollbar-hide py-6">
      <div className="mx-auto w-full max-w-2xl space-y-4 px-4">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" className="h-8 w-8 rounded-lg text-muted-foreground hover:text-foreground" onClick={onBack} aria-label="Back to Add Connection">
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <Cloud className="size-4 text-muted-foreground" aria-hidden />
          <h2 className="text-sm font-semibold">Oracle Cloud database</h2>
        </div>
        <p className="text-sm text-muted-foreground">
          Enter the database like your app&apos;s .env. The studio reaches its private address through your own Kubernetes cluster; nothing is created in Oracle Cloud.
        </p>
        <form onSubmit={submit}>
          <Card className="space-y-4 border-studio-border/60 bg-studio-bg/80 p-5">
            <EngineToggle options={ENGINES} value={values.engine} onChange={(id) => set("engine", id)} />
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-[1fr_8rem]">
              <FormField label="Host" placeholder="10.0.10.56" {...field("host")} />
              <FormField label="Port" {...field("port")} />
            </div>
            <FormField label="Database" placeholder="orderlink_prod" optional {...field("database")} />
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <FormField label="User" {...field("username")} />
              <FormField label="Password" secret {...field("password")} />
            </div>
            <FormField label="Name (optional)" placeholder="OrderLink prod" optional {...field("name")} />
            <CheckResult check={check} routedMarker={ROUTED_MARKER} />
            <div className="flex flex-wrap justify-end gap-2">
              <Button type="button" variant="outline" disabled={busy} onClick={test} className="gap-1.5">
                <PlugZap className="size-4" aria-hidden /> Test connection
              </Button>
              <Button type="submit" disabled={busy}>
                {busy && check.saving ? "Saving…" : "Save connection"}
              </Button>
            </div>
          </Card>
        </form>
      </div>
    </div>
  );
}
