import net from "node:net";
import type { CandidateEngine, DatabaseCandidate } from "../../lib/discovery/database-candidate";

/** A well-known port and the engine that usually answers on it. */
export type KnownPort = { port: number; engine: CandidateEngine; label: string };

/** The ports the detector knocks on; ClickHouse's native 9000 is left out because too many other things use it. */
export const KNOWN_PORTS: ReadonlyArray<KnownPort> = [
  { port: 5432, engine: "postgres", label: "PostgreSQL" },
  { port: 5433, engine: "postgres", label: "PostgreSQL" },
  { port: 3306, engine: "mysql", label: "MySQL / MariaDB" },
  { port: 3307, engine: "mysql", label: "MySQL / MariaDB" },
  { port: 27017, engine: "mongodb", label: "MongoDB" },
  { port: 6379, engine: "redis", label: "Redis" },
  { port: 1433, engine: "mssql", label: "SQL Server" },
  { port: 8123, engine: "clickhouse", label: "ClickHouse" },
  { port: 1521, engine: "oracle", label: "Oracle" },
];

const CONNECT_TIMEOUT_MS = 700;

// isPortOpen reports whether something accepts TCP connections on host:port within the timeout.
export function isPortOpen(host: string, port: number, timeoutMs = CONNECT_TIMEOUT_MS): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port });
    const finish = (open: boolean) => {
      socket.destroy();
      resolve(open);
    };
    socket.setTimeout(timeoutMs, () => finish(false));
    socket.once("error", () => finish(false));
    socket.once("connect", () => finish(true));
  });
}

// probeKnownPorts knocks on every well-known database port of a host at once and returns the open ones.
export async function probeKnownPorts(host = "127.0.0.1", ports: ReadonlyArray<KnownPort> = KNOWN_PORTS): Promise<DatabaseCandidate[]> {
  const open = await Promise.all(ports.map(async (p) => ((await isPortOpen(host, p.port)) ? p : null)));
  return open
    .filter((p): p is KnownPort => p !== null)
    .map((p) => ({ engine: p.engine, host, port: p.port, source: "port" as const, label: `${p.label} on ${host}:${p.port}` }));
}
