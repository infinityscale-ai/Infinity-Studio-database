import type { KubeTunnel } from "./tunnel";

/** What makes two requests the same tunnel: one relay per database, per cluster and namespace. */
export type TunnelKey = { clusterId: string; namespace: string; host: string; port: number };

/** Opens a brand new tunnel; the registry calls this only when no live one matches. */
export type TunnelOpener = () => Promise<KubeTunnel>;

/** One shared relay: the tunnel, how many callers hold it now, and the pending close once none do. */
type Entry = { tunnel: Promise<KubeTunnel>; leases: number; idleTimer: ReturnType<typeof setTimeout> | null };

/** How long an unused relay stays up, so the next click reuses it instead of starting a new pod. */
export const IDLE_CLOSE_MS = 120_000;

/** Every tunnel this process has open, so the same database never starts a second relay. */
const live = new Map<string, Entry>();
let cleanupArmed = false;

// tunnelKey renders a key as one string.
export function tunnelKey(key: TunnelKey): string {
  return `${key.clusterId}|${key.namespace}|${key.host}:${key.port}`;
}

// closeAllTunnels takes down every relay this process started; called when the studio stops.
export async function closeAllTunnels(): Promise<void> {
  const open = [...live.values()];
  live.clear();
  for (const entry of open) if (entry.idleTimer) clearTimeout(entry.idleTimer);
  await Promise.allSettled(open.map(async (e) => (await e.tunnel).close()));
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

// forget drops an entry that is still the one registered under its id.
function forget(id: string, entry: Entry): void {
  if (live.get(id) !== entry) return;
  live.delete(id);
  if (entry.idleTimer) clearTimeout(entry.idleTimer);
}

// release ends one caller's hold; the relay closes only after the last holder lets go and it then stays unused for idleMs.
function release(id: string, entry: Entry, idleMs: number): void {
  entry.leases = Math.max(0, entry.leases - 1);
  if (entry.leases > 0 || live.get(id) !== entry) return;
  entry.idleTimer = setTimeout(() => {
    if (entry.leases > 0 || live.get(id) !== entry) return;
    forget(id, entry);
    void entry.tunnel.then((t) => t.close()).catch(() => {});
  }, idleMs);
}

// registered returns the live entry for a key, starting the relay when there is none.
function registered(id: string, open: TunnelOpener): Entry {
  const existing = live.get(id);
  if (existing) return existing;
  const entry: Entry = { tunnel: open(), leases: 0, idleTimer: null };
  live.set(id, entry);
  entry.tunnel.then((t) => void t.closed.then(() => forget(id, entry)), () => forget(id, entry));
  return entry;
}

// getOrOpenTunnel lends the live relay serving a database, or opens the only one there will be; returning the loan never cuts another caller off.
export async function getOrOpenTunnel(key: TunnelKey, open: TunnelOpener, idleMs: number = IDLE_CLOSE_MS): Promise<KubeTunnel> {
  armCleanup();
  const id = tunnelKey(key);
  const entry = registered(id, open);
  entry.leases += 1;
  if (entry.idleTimer) clearTimeout(entry.idleTimer);
  entry.idleTimer = null;
  try {
    const tunnel = await entry.tunnel;
    let returned = false;
    const close = async () => {
      if (returned) return;
      returned = true;
      release(id, entry, idleMs);
    };
    return { ...tunnel, close };
  } catch (err) {
    forget(id, entry);
    throw err;
  }
}
