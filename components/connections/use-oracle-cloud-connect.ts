"use client";

import { useCallback, useState } from "react";
import { checkConnection, ociAddress, saveConnection } from "@/lib/api/discover-client";
import type { OciAddressResult } from "@/lib/oci/oci-database";
import type { ConnectionCheckState } from "@/components/connections/connection-form-parts";
import { engineLabel, providerOf } from "@/lib/discovery/database-candidate";

/** The engines an Oracle Cloud database can be typed in as. */
export type OracleCloudEngine = "mysql" | "postgres";

/** What the form holds: the database typed in like an app's .env. */
export type OracleCloudValues = { name: string; engine: OracleCloudEngine; host: string; port: string; database: string; username: string; password: string };

/** Each engine's default port, swapped in when the user has not typed another one. */
const DEFAULT_PORT: Record<OracleCloudEngine, string> = { mysql: "3306", postgres: "5432" };

const EMPTY: OracleCloudValues = { name: "", engine: "mysql", host: "", port: DEFAULT_PORT.mysql, database: "", username: "", password: "" };

// withEngine switches the engine, moving the port to the new default only when it still holds the old one.
export function withEngine(values: OracleCloudValues, engine: OracleCloudEngine): OracleCloudValues {
  const port = values.port === DEFAULT_PORT[values.engine] || values.port === "" ? DEFAULT_PORT[engine] : values.port;
  return { ...values, engine, port };
}

// routeAndCheck asks for the route through the user's cluster, then opens the database once with the typed login.
async function routeAndCheck(values: OracleCloudValues): Promise<OciAddressResult> {
  const route = await ociAddress({
    engine: values.engine, host: values.host.trim(), port: Number(values.port), database: values.database.trim(),
    username: values.username.trim(), password: values.password,
  });
  const check = await checkConnection(route.connectionString, providerOf(values.engine));
  if (!check.success) throw new Error(check.error || "The database did not answer.");
  return route;
}

// nameFor picks the saved name: the typed one, Oracle's own name for the database, or the engine and host.
function nameFor(values: OracleCloudValues, route: OciAddressResult): string {
  return values.name.trim() || route.managedName || `${engineLabel(values.engine)} ${values.host.trim()}`;
}

// useOracleCloudConnect holds the typed database and runs the check and the save, keeping every value on failure.
export function useOracleCloudConnect(onSaved: () => void) {
  const [values, setValues] = useState<OracleCloudValues>(EMPTY);
  const [check, setCheck] = useState<ConnectionCheckState>({ status: "idle" });
  const set = useCallback((field: keyof OracleCloudValues, value: string) => {
    setValues((v) => (field === "engine" ? withEngine(v, value as OracleCloudEngine) : { ...v, [field]: value }));
    setCheck({ status: "idle" });
  }, []);
  const run = useCallback(async (save: boolean) => {
    setCheck({ status: "working", saving: save });
    try {
      const route = await routeAndCheck(values);
      if (save) {
        await saveConnection({ name: nameFor(values, route), connectionString: route.connectionString, connectionType: providerOf(values.engine) });
        onSaved();
      }
      setCheck({ status: "ok", message: `${route.managedName ?? "The database"} answered through your cluster ${route.cluster}, and the login works.` });
    } catch (e) {
      setCheck({ status: "error", error: (e as Error).message || "The check failed." });
    }
  }, [values, onSaved]);
  return { values, set, check, test: () => void run(false), save: () => void run(true) };
}
