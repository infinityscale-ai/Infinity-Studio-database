import { OCI_DATABASE_PARAM } from "@/lib/oci/oci-database";

/** The little of a saved connection the matching needs. */
export type SavedLike = { id: number; connectionString: string };

/** Names that all mean this machine. */
const LOOPBACK = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

// endpointOf reads host:port out of a connection string, folding the loopback names together; null when it has none.
export function endpointOf(connectionString: string): string | null {
  try {
    const url = new URL(connectionString);
    if (!url.hostname || !url.port) return null;
    const host = LOOPBACK.has(url.hostname.toLowerCase()) ? "127.0.0.1" : url.hostname.toLowerCase();
    return `${host}:${url.port}`;
  } catch {
    return null;
  }
}

// ociDatabaseOf reads which Oracle Cloud database a saved connection came from, or null.
export function ociDatabaseOf(connectionString: string): string | null {
  try {
    return new URL(connectionString).searchParams.get(OCI_DATABASE_PARAM);
  } catch {
    return null;
  }
}

// savedForEndpoint finds the saved connection that already points at a found local database.
export function savedForEndpoint<T extends SavedLike>(saved: T[], host: string, port: number): T | null {
  const wanted = endpointOf(`x://${host}:${port}`);
  if (!wanted) return null;
  return saved.find((c) => !ociDatabaseOf(c.connectionString) && endpointOf(c.connectionString) === wanted) ?? null;
}

// isOciRouted reports whether a saved connection reaches an Oracle Cloud database through the user's cluster.
export function isOciRouted(connectionString: string): boolean {
  if (ociDatabaseOf(connectionString)) return true;
  try {
    return new URL(connectionString).searchParams.get("infstudio_k8s_mode") === "k8s";
  } catch {
    return false;
  }
}
