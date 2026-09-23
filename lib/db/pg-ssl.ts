import { getPgHost, getPgPort, normalizePgConnectionString, validateSslMode } from "./pg-connection";
import { probePgSslSupport } from "./pg-ssl-probe";
import { readTlsParams } from "./tls-params";

/** What node-postgres accepts for its ssl option; ca and servername let verify-full work through a local tunnel port. */
export type PgSslOption = false | { rejectUnauthorized: boolean; ca?: string; servername?: string };

// verifiedSsl is verification on, with the connection string's own CA and certificate name when it carries them.
function verifiedSsl(search: URLSearchParams): PgSslOption {
  const tls = readTlsParams(search);
  return { rejectUnauthorized: true, ...(tls.ca ? { ca: tls.ca } : {}), ...(tls.servername ? { servername: tls.servername } : {}) };
}

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
  if (sslMode === "verify-full" || sslMode === "verify-ca") return verifiedSsl(parsed.searchParams);
  if (sslMode === "require") return { rejectUnauthorized: false };
  const supportsSsl = await probePgSslSupport(getPgHost(connectionString), getPgPort(connectionString));
  return supportsSsl === false ? false : { rejectUnauthorized: false };
}
