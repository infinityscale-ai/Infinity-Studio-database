import { getPgHost, getPgPort, normalizePgConnectionString, validateSslMode } from "./pg-connection";
import { probePgSslSupport } from "./pg-ssl-probe";

/** What node-postgres accepts for its ssl option. */
export type PgSslOption = false | { rejectUnauthorized: boolean };

// getPgSslConfig turns the URL's sslmode into node-postgres's ssl option; prefer and allow ask the server first, since node-postgres never falls back on its own.
export async function getPgSslConfig(connectionString: string): Promise<PgSslOption> {
  let parsed: URL;
  try {
    parsed = new URL(normalizePgConnectionString(connectionString));
  } catch {
    return false;
  }
  const sslMode = validateSslMode(parsed.searchParams.get("sslmode") || "prefer");
  if (sslMode === "disable") return false;
  if (sslMode === "verify-full" || sslMode === "verify-ca") return { rejectUnauthorized: true };
  if (sslMode === "require") return { rejectUnauthorized: false };
  const supportsSsl = await probePgSslSupport(getPgHost(connectionString), getPgPort(connectionString));
  return supportsSsl === false ? false : { rejectUnauthorized: false };
}
