/** The connection-string parameters that say a database is reached through a Kubernetes cluster. */
export type KubeTunnelParams = { profile: string; cluster: string; namespace: string };

/** What a started tunnel hands back: where to connect now, how to close it, and a signal that settles once it has gone. */
export type KubeTunnelHandle = { connectionString: string; close: () => Promise<void>; closed: Promise<void> };

const PREFIX = "infstudio_k8s_";
/** The default namespace for the throwaway relay pod. */
const DEFAULT_NAMESPACE = "default";

// readKubeTunnelParams reads the Kubernetes routing out of a connection string, or null when it is a direct connection.
export function readKubeTunnelParams(connectionString: string, normalize: (s: string) => string): KubeTunnelParams | null {
  let url: URL;
  try {
    url = new URL(normalize(connectionString));
  } catch {
    return null;
  }
  if (url.searchParams.get(`${PREFIX}mode`) !== "k8s") return null;
  const cluster = url.searchParams.get(`${PREFIX}cluster`) ?? "";
  const profile = url.searchParams.get(`${PREFIX}profile`) ?? "";
  if (!cluster || !profile) return null;
  return { profile, cluster, namespace: url.searchParams.get(`${PREFIX}namespace`) || DEFAULT_NAMESPACE };
}

// stripKubeParams removes the routing parameters so the driver never sees them.
export function stripKubeParams(url: URL): URL {
  for (const key of [...url.searchParams.keys()]) if (key.startsWith(PREFIX)) url.searchParams.delete(key);
  return url;
}

// buildKubeConnectionString writes the connection string a saved Kubernetes-routed database carries.
export function buildKubeConnectionString(base: string, params: KubeTunnelParams): string {
  const url = new URL(base);
  url.searchParams.set(`${PREFIX}mode`, "k8s");
  url.searchParams.set(`${PREFIX}profile`, params.profile);
  url.searchParams.set(`${PREFIX}cluster`, params.cluster);
  url.searchParams.set(`${PREFIX}namespace`, params.namespace);
  return url.toString();
}

// startKubeTunnelIfNeeded opens a relay in the cluster when the connection string asks for one, and rewrites it to the local port.
export async function startKubeTunnelIfNeeded(connectionString: string, defaultPort: number, normalize: (s: string) => string): Promise<KubeTunnelHandle | null> {
  const params = readKubeTunnelParams(connectionString, normalize);
  if (!params) return null;
  const url = new URL(normalize(connectionString));
  const target = { host: url.hostname, port: Number(url.port || String(defaultPort)) || defaultPort };
  const { openKubeTunnel } = await import("../../server/k8s/tunnel");
  const tunnel = await openKubeTunnel({ profileName: params.profile, clusterId: params.cluster, namespace: params.namespace, target });
  const local = stripKubeParams(new URL(url.toString()));
  local.hostname = "127.0.0.1";
  local.port = String(tunnel.localPort);
  return { connectionString: local.toString(), close: tunnel.close, closed: tunnel.closed };
}
