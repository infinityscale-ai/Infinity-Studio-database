import { API_BASE, apiFetch } from "@/lib/api-base";
import type { DiscoverResult } from "@/lib/discovery/database-candidate";
import type { OciBastionAnswer, OciConnectRequest, OciDatabaseSummary, OciStatus, OciTunnelResult } from "@/lib/oci/oci-database";

/** A failed studio API call, with the code the panels branch on. */
export class DiscoverApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code: string,
  ) {
    super(message);
    this.name = "DiscoverApiError";
  }
}

/** The envelope every sidecar route answers with. */
type Envelope<T> = { success: boolean; data?: T; error?: string; code?: string };

// call sends one JSON request to the sidecar and unwraps its envelope, throwing a coded error on failure.
async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await apiFetch(new URL(path, API_BASE).toString(), { ...init, headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) } });
  const body = (await res.json().catch(() => ({ success: false }))) as Envelope<T>;
  if (!res.ok || !body.success) throw new DiscoverApiError(body.error || `Request failed (HTTP ${res.status}).`, res.status, body.code || "failed");
  return body.data as T;
}

// localToolsEnabled asks whether this studio serves the machine scan and the Oracle Cloud sign-in at all.
export async function localToolsEnabled(): Promise<boolean> {
  try {
    return (await call<{ enabled: boolean }>("/api/local-tools")).enabled === true;
  } catch {
    return false;
  }
}

// discoverLocal scans this machine for databases.
export function discoverLocal(): Promise<DiscoverResult> {
  return call<DiscoverResult>("/api/discover/local", { method: "POST", body: "{}" });
}

// ociStatus reports whether the OCI CLI is installed and which profiles it has.
export function ociStatus(): Promise<OciStatus> {
  return call<OciStatus>("/api/oci/status");
}

// ociLogin refreshes or opens the browser sign-in for a profile; it resolves once the session is usable.
export function ociLogin(profile: string): Promise<{ ok: boolean }> {
  return call<{ ok: boolean }>("/api/oci/login", { method: "POST", body: JSON.stringify({ profile }) });
}

// ociDatabases lists the databases a profile can see across the tenancy.
export function ociDatabases(profile: string): Promise<OciDatabaseSummary[]> {
  return call<OciDatabaseSummary[]>(`/api/oci/databases?profile=${encodeURIComponent(profile)}`);
}

// ociBastion resolves a database's endpoint and the bastion for its network, creating one only when asked.
export function ociBastion(profile: string, database: OciDatabaseSummary, create: boolean): Promise<OciBastionAnswer> {
  return call<OciBastionAnswer>("/api/oci/bastion", { method: "POST", body: JSON.stringify({ profile, database, create }) });
}

// ociConnect opens a bastion session and returns the connection string that tunnels through it.
export function ociConnect(request: OciConnectRequest): Promise<OciTunnelResult> {
  return call<OciTunnelResult>("/api/oci/connect", { method: "POST", body: JSON.stringify(request) });
}

/** What a saved connection needs. */
export type SaveConnectionInput = { name: string; connectionString: string; connectionType: string };

// saveConnection stores a finished connection in the studio, the same way the connection form does.
export async function saveConnection(input: SaveConnectionInput): Promise<void> {
  await call<unknown>("/api/connections", { method: "POST", body: JSON.stringify(input) });
}
