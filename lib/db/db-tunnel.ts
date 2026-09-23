import { startKubeTunnelIfNeeded } from "./kube-tunnel";
import { startSshTunnelIfNeeded, type TunnelHandle } from "./ssh-tunnel";

// startTunnelIfNeeded opens whichever tunnel the connection string asks for: a cluster relay, an SSH hop, or none.
export async function startTunnelIfNeeded(connectionString: string, defaultPort: number, normalize: (s: string) => string): Promise<TunnelHandle> {
  const kube = await startKubeTunnelIfNeeded(connectionString, defaultPort, normalize);
  if (kube) return kube;
  return startSshTunnelIfNeeded(connectionString, defaultPort, normalize);
}
