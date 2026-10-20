"use client";

import { CheckCircle2, Loader2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ConnectionFailureDetails } from "@/components/connections/connection-failure-details";
import { adviseOnFailure } from "@/lib/db/connection-failure";
import { cn } from "@/lib/utils";

// The pieces the typed-in connection screens (Localhost, Oracle Cloud) are built from.

/** Where a check or a save is: nothing yet, running, through with what to say, or failed with the studio's own words. */
export type ConnectionCheckState =
  | { status: "idle" }
  | { status: "working"; saving: boolean }
  | { status: "ok"; message: string }
  | { status: "error"; error: string };

/** One labelled text input. */
export type FormFieldProps = { id: string; label: string; value: string; onChange: (v: string) => void; placeholder?: string; secret?: boolean; optional?: boolean };

// FormField is one labelled input of a typed-in connection.
export function FormField({ id, label, value, onChange, placeholder, secret, optional }: FormFieldProps) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        type={secret ? "password" : "text"}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        autoComplete={secret ? "new-password" : "off"}
        required={!optional}
      />
    </div>
  );
}

/** The engine choice: its options, the chosen one, and what changes it. */
export type EngineToggleProps<T extends string> = { options: Array<{ id: T; label: string }>; value: T; onChange: (id: T) => void };

// EngineToggle chooses which engine the database speaks, as a row of pressed/unpressed buttons.
export function EngineToggle<T extends string>({ options, value, onChange }: EngineToggleProps<T>) {
  return (
    <div className="flex flex-wrap gap-2" role="group" aria-label="Database engine">
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          aria-pressed={value === o.id}
          onClick={() => onChange(o.id)}
          className={cn(
            "min-w-[7rem] flex-1 rounded-lg border px-3 py-2 text-sm",
            value === o.id ? "border-foreground/60 bg-studio-row-hover text-foreground" : "border-studio-border/60 text-muted-foreground hover:text-foreground",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

// CheckResult says what the last check found: running, through, or why not and what to do (routed says the failure went through a cluster).
export function CheckResult({ check, routedMarker }: { check: ConnectionCheckState; routedMarker?: string }) {
  if (check.status === "idle") return null;
  if (check.status === "working") {
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
        <Loader2 className="size-4 animate-spin" aria-hidden /> Connecting to the database…
      </p>
    );
  }
  if (check.status === "ok") {
    return (
      <p className="flex items-center gap-2 text-sm text-foreground" role="status">
        <CheckCircle2 className="size-4 shrink-0" aria-hidden /> {check.message}
      </p>
    );
  }
  return <ConnectionFailureDetails advice={adviseOnFailure(check.error, routedMarker)} error={check.error} />;
}
