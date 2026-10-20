"use client";

import { useCallback, useState } from "react";
import { checkConnection, saveConnection } from "@/lib/api/discover-client";
import type { ConnectionCheckState } from "@/components/connections/connection-form-parts";
import { candidateConnectionString, engineLabel, providerOf, type DatabaseCandidate } from "@/lib/discovery/database-candidate";

/** The engines a database on this computer can be typed in as. */
export type LocalhostEngine = "mysql" | "mariadb" | "postgres" | "mongodb" | "redis";

/** What the form holds: a database on this computer, the login optional. */
export type LocalhostValues = { name: string; engine: LocalhostEngine; host: string; port: string; database: string; username: string; password: string };

/** Each engine's default port, swapped in when the user has not typed another one. */
const DEFAULT_PORT: Record<LocalhostEngine, string> = { mysql: "3306", mariadb: "3306", postgres: "5432", mongodb: "27017", redis: "6379" };

// emptyValues starts the form on MySQL at this computer's address.
export function emptyValues(host: string): LocalhostValues {
  return { name: "", engine: "mysql", host, port: DEFAULT_PORT.mysql, database: "", username: "", password: "" };
}

// withLocalEngine switches the engine, moving the port to the new default only when it still holds the old one.
export function withLocalEngine(values: LocalhostValues, engine: LocalhostEngine): LocalhostValues {
  const port = values.port === DEFAULT_PORT[values.engine] || values.port === "" ? DEFAULT_PORT[engine] : values.port;
  return { ...values, engine, port };
}

// valuesFrom fills the form from a database found on this machine, credentials included when the scan knew them.
export function valuesFrom(c: DatabaseCandidate): LocalhostValues | null {
  if (!(c.engine in DEFAULT_PORT)) return null;
  return {
    name: c.container ?? "", engine: c.engine as LocalhostEngine, host: c.host, port: String(c.port),
    database: c.database ?? "", username: c.username ?? "", password: c.password ?? "",
  };
}

// localhostConnectionString renders the typed database as the URL the studio connects with, leaving out what is empty.
export function localhostConnectionString(v: LocalhostValues): string {
  return candidateConnectionString({
    engine: v.engine, host: v.host.trim(), port: Number(v.port), source: "port", label: "",
    username: v.username.trim() || undefined, password: v.password || undefined, database: v.database.trim() || undefined,
  });
}

// useLocalhostConnect holds the typed database and runs the check and the save, keeping every value on failure.
export function useLocalhostConnect(host: string, onSaved: () => void) {
  const [values, setValues] = useState<LocalhostValues>(() => emptyValues(host));
  const [check, setCheck] = useState<ConnectionCheckState>({ status: "idle" });
  const set = useCallback((field: keyof LocalhostValues, value: string) => {
    setValues((v) => (field === "engine" ? withLocalEngine(v, value as LocalhostEngine) : { ...v, [field]: value }));
    setCheck({ status: "idle" });
  }, []);
  const fill = useCallback((next: LocalhostValues) => {
    setValues(next);
    setCheck({ status: "idle" });
  }, []);
  const run = useCallback(async (save: boolean) => {
    setCheck({ status: "working", saving: save });
    try {
      const connectionString = localhostConnectionString(values);
      const result = await checkConnection(connectionString, providerOf(values.engine));
      if (!result.success) throw new Error(result.error || "The database did not answer.");
      if (save) {
        const name = values.name.trim() || `${engineLabel(values.engine)} on port ${values.port}`;
        await saveConnection({ name, connectionString, connectionType: providerOf(values.engine) });
        onSaved();
      }
      setCheck({ status: "ok", message: `Connected to ${engineLabel(values.engine)} on ${values.host.trim()}:${values.port}.` });
    } catch (e) {
      setCheck({ status: "error", error: (e as Error).message || "The check failed." });
    }
  }, [values, onSaved]);
  return { values, set, fill, check, test: () => void run(false), save: () => void run(true) };
}
