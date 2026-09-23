import type { CandidateEngine, DatabaseCandidate } from "../../lib/discovery/database-candidate";
import { dockerEngine, type DockerEngine, type EngineRecord } from "./docker-engine";
import type { DiscoveryRuntime } from "./runtime";

/** Credentials the official images announce through their environment. */
type Credentials = Pick<DatabaseCandidate, "username" | "password" | "database">;

/** How a container's database is addressed from where the sidecar runs. */
export type Addressing = { hostAlias: string; sharedNetworks: ReadonlySet<string> };

/** Image name fragments and the engine they run, first match wins. */
const IMAGE_ENGINES: ReadonlyArray<{ match: RegExp; engine: CandidateEngine; port: number }> = [
  { match: /(^|\/)(postgres|postgresql|timescaledb|pgvector|supabase\/postgres)(:|$)/, engine: "postgres", port: 5432 },
  { match: /(^|\/)mariadb(:|$)/, engine: "mariadb", port: 3306 },
  { match: /(^|\/)(mysql|percona)(:|$)/, engine: "mysql", port: 3306 },
  { match: /(^|\/)mongo(db)?(:|$)/, engine: "mongodb", port: 27017 },
  { match: /(^|\/)(redis|valkey|keydb)(:|$)/, engine: "redis", port: 6379 },
  { match: /(^|\/)(mssql\/server|azure-sql-edge)(:|$)/, engine: "mssql", port: 1433 },
  { match: /(^|\/)clickhouse(-server)?(:|$)/, engine: "clickhouse", port: 8123 },
  { match: /(^|\/)(oracle-free|oracle-xe|database\/free|database\/express)(:|$)/, engine: "oracle", port: 1521 },
];

// engineFromImage maps an image reference to the engine it runs and its default port, or null.
export function engineFromImage(image: string): { engine: CandidateEngine; port: number } | null {
  const ref = image.toLowerCase().replace(/@sha256:.*$/, "");
  for (const { match, engine, port } of IMAGE_ENGINES) if (match.test(ref)) return { engine, port };
  return null;
}

// envValue reads one KEY=value entry out of a container's environment.
function envValue(env: string[], key: string): string | undefined {
  const hit = env.find((e) => e.startsWith(`${key}=`));
  return hit ? hit.slice(key.length + 1) : undefined;
}

// credentialsFromEnv reads the official images' environment conventions into a login.
export function credentialsFromEnv(engine: CandidateEngine, env: string[]): Credentials {
  const get = (...keys: string[]) => keys.map((k) => envValue(env, k)).find((v) => v !== undefined);
  switch (engine) {
    case "postgres":
      return { username: get("POSTGRES_USER") || "postgres", password: get("POSTGRES_PASSWORD"), database: get("POSTGRES_DB") || get("POSTGRES_USER") || "postgres" };
    case "mysql":
    case "mariadb": {
      const user = get("MYSQL_USER", "MARIADB_USER");
      const password = user ? get("MYSQL_PASSWORD", "MARIADB_PASSWORD") : get("MYSQL_ROOT_PASSWORD", "MARIADB_ROOT_PASSWORD");
      return { username: user || "root", password, database: get("MYSQL_DATABASE", "MARIADB_DATABASE") };
    }
    case "mongodb":
      return { username: get("MONGO_INITDB_ROOT_USERNAME"), password: get("MONGO_INITDB_ROOT_PASSWORD"), database: get("MONGO_INITDB_DATABASE") };
    case "redis":
      return { password: get("REDIS_PASSWORD") };
    case "mssql":
      return { username: "sa", password: get("MSSQL_SA_PASSWORD", "SA_PASSWORD") };
    case "clickhouse":
      return { username: get("CLICKHOUSE_USER") || "default", password: get("CLICKHOUSE_PASSWORD"), database: get("CLICKHOUSE_DB") };
    case "oracle":
      return { username: "system", password: get("ORACLE_PASSWORD", "ORACLE_PWD"), database: get("ORACLE_DATABASE") };
  }
}

// publishedPort finds the host port a container port is published on, or null when it is not.
export function publishedPort(ports: EngineRecord | undefined, containerPort: number): number | null {
  const bindings = ports?.[`${containerPort}/tcp`];
  if (!Array.isArray(bindings) || bindings.length === 0) return null;
  const list = bindings as Array<{ HostIp?: string; HostPort?: string }>;
  const b = list.find((x) => !x.HostIp || ["0.0.0.0", "127.0.0.1", "::"].includes(x.HostIp)) ?? list[0];
  const port = Number(b.HostPort);
  return Number.isInteger(port) && port > 0 ? port : null;
}

// sharedNetworkAddress finds the container's IP on a network the sidecar is also on, or null.
export function sharedNetworkAddress(settings: EngineRecord | undefined, shared: ReadonlySet<string>): string | null {
  const networks = (settings?.Networks ?? {}) as Record<string, { IPAddress?: string }>;
  for (const [name, net] of Object.entries(networks)) if (shared.has(name) && net.IPAddress) return net.IPAddress;
  return null;
}

// reachableAddress picks where the sidecar can connect: the published port on the host, else a shared network.
export function reachableAddress(settings: EngineRecord | undefined, containerPort: number, addressing: Addressing): { host: string; port: number } | null {
  const published = publishedPort(settings?.Ports as EngineRecord | undefined, containerPort);
  if (published !== null) return { host: addressing.hostAlias, port: published };
  const ip = sharedNetworkAddress(settings, addressing.sharedNetworks);
  return ip ? { host: ip, port: containerPort } : null;
}

// candidateFromContainer turns one inspect record into a candidate, or null when it is not a reachable database.
export function candidateFromContainer(info: EngineRecord, addressing: Addressing): DatabaseCandidate | null {
  const config = (info.Config ?? {}) as EngineRecord;
  const image = typeof config.Image === "string" ? config.Image : "";
  const engine = engineFromImage(image);
  if (!engine) return null;
  const address = reachableAddress(info.NetworkSettings as EngineRecord | undefined, engine.port, addressing);
  if (!address) return null;
  const env = Array.isArray(config.Env) ? (config.Env as string[]) : [];
  const name = typeof info.Name === "string" ? info.Name.replace(/^\//, "") : image;
  return { engine: engine.engine, ...address, source: "docker", label: `${name} (${image})`, container: name, ...credentialsFromEnv(engine.engine, env) };
}

// ownNetworks lists the networks the sidecar's own container is attached to, or none when it cannot tell.
async function ownNetworks(engine: DockerEngine, selfId: string | null): Promise<Set<string>> {
  if (!selfId) return new Set();
  try {
    const self = await engine.inspect(selfId);
    return new Set(Object.keys(((self.NetworkSettings as EngineRecord | undefined)?.Networks ?? {}) as object));
  } catch {
    return new Set();
  }
}

// discoverDockerDatabases asks the Engine for the running containers and returns the databases the sidecar can reach.
export async function discoverDockerDatabases(runtime: DiscoveryRuntime, engine: DockerEngine = dockerEngine): Promise<DatabaseCandidate[]> {
  const ids = await engine.listRunning();
  if (ids.length === 0) return [];
  const [infos, shared] = await Promise.all([Promise.all(ids.map((id) => engine.inspect(id))), ownNetworks(engine, runtime.selfId)]);
  const addressing: Addressing = { hostAlias: runtime.hostAlias, sharedNetworks: shared };
  return infos.map((info) => candidateFromContainer(info, addressing)).filter((c): c is DatabaseCandidate => c !== null);
}
