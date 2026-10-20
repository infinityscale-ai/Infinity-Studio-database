import { API_BASE, apiFetch } from "@/lib/api-base";
import type { DiscoverResult } from "@/lib/discovery/database-candidate";
import type { OciAddressRequest, OciAddressResult } from "@/lib/oci/oci-database";

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

/** Whether this studio serves the local tools, and how it addresses this computer. */
export type LocalTools = { enabled: boolean; hostAlias: string };

const NO_LOCAL_TOOLS: LocalTools = { enabled: false, hostAlias: "127.0.0.1" };

// localTools asks whether this studio serves the machine scan and Oracle Cloud at all, and the host name of this computer.
export async function localTools(): Promise<LocalTools> {
  try {
    const answer = await call<{ enabled: boolean; hostAlias?: string | null }>("/api/local-tools");
    return { enabled: answer.enabled === true, hostAlias: answer.hostAlias || NO_LOCAL_TOOLS.hostAlias };
  } catch {
    return NO_LOCAL_TOOLS;
  }
}

// localToolsEnabled asks only whether this studio serves the local tools.
export async function localToolsEnabled(): Promise<boolean> {
  return (await localTools()).enabled;
}

// discoverLocal scans this machine for databases.
export function discoverLocal(): Promise<DiscoverResult> {
  return call<DiscoverResult>("/api/discover/local", { method: "POST", body: "{}" });
}

// ociAddress returns the connection string that reaches a typed Oracle Cloud database through the user's own cluster.
export function ociAddress(request: OciAddressRequest): Promise<OciAddressResult> {
  return call<OciAddressResult>("/api/oci/address", { method: "POST", body: JSON.stringify(request) });
}

/** What a saved connection needs. */
export type SaveConnectionInput = { name: string; connectionString: string; connectionType: string };

// saveConnection stores a finished connection in the studio, the same way the connection form does.
export async function saveConnection(input: SaveConnectionInput): Promise<void> {
  await call<unknown>("/api/connections", { method: "POST", body: JSON.stringify(input) });
}

/** What the studio answers when it tries a connection string. */
export type ConnectionCheck = { success: boolean; error?: string };

// checkConnection asks the studio to open a connection string once and report whether it worked.
export async function checkConnection(connectionString: string, connectionType: string): Promise<ConnectionCheck> {
  const res = await apiFetch(new URL("/api/connections/test", API_BASE).toString(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ connectionString, connectionType }),
  });
  const body = (await res.json().catch(() => ({ success: false }))) as ConnectionCheck;
  return res.ok ? body : { success: false, error: body.error || `Request failed (HTTP ${res.status}).` };
}
