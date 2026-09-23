import type { KubeTunnel } from "./tunnel";

/** What makes two requests the same tunnel: one relay per database, per cluster and namespace. */
export type TunnelKey = { clusterId: string; namespace: string; host: string; port: number };

/** Opens a brand new tunnel; the registry calls this only when no live one matches. */
export type TunnelOpener = () => Promise<KubeTunnel>;

/** Every tunnel this process has open, so the same database never starts a second relay. */
const live = new Map<string, Promise<KubeTunnel>>();
let cleanupArmed = false;

// tunnelKey renders a key as one string.
export function tunnelKey(key: TunnelKey): string {
  return `${key.clusterId}|${key.namespace}|${key.host}:${key.port}`;
}

// closeAllTunnels takes down every relay this process started; called when the studio stops.
export async function closeAllTunnels(): Promise<void> {
  const open = [...live.values()];
  live.clear();
  await Promise.allSettled(open.map(async (p) => (await p).close()));
}

// armCleanup makes sure the relays go away when the studio does, however it stops.
function armCleanup(): void {
  if (cleanupArmed) return;
  cleanupArmed = true;
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.once(signal, () => {
      void closeAllTunnels().finally(() => process.exit(0));
    });
  }
  process.once("beforeExit", () => void closeAllTunnels());
}

// getOrOpenTunnel reuses the live relay serving a database, or opens the only one there will be; a relay that has gone is forgotten at once.
export async function getOrOpenTunnel(key: TunnelKey, open: TunnelOpener): Promise<KubeTunnel> {
  armCleanup();
  const id = tunnelKey(key);
  const existing = live.get(id);
  if (existing) {
    try {
      return await existing;
    } catch {
      live.delete(id);
    }
  }
  const forget = () => {
    if (live.get(id) === started) live.delete(id);
  };
  const started: Promise<KubeTunnel> = open().then((tunnel) => {
    void tunnel.closed.then(forget);
    return {
      ...tunnel,
      close: async () => {
        forget();
        await tunnel.close();
      },
    };
  });
  live.set(id, started);
  try {
    return await started;
  } catch (err) {
    live.delete(id);
    throw err;
  }
}
