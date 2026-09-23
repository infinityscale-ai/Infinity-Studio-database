import { execFile } from "node:child_process";
import type { CandidateEngine, DatabaseCandidate } from "../../lib/discovery/database-candidate";

/** Runs the docker CLI and returns stdout; injected so tests can fake it. */
export type DockerExec = (args: string[]) => Promise<string>;

/** One `docker inspect` record, read field by field. */
type Raw = Record<string, unknown>;

/** Credentials the official images announce through their environment. */
type Credentials = Pick<DatabaseCandidate, "username" | "password" | "database">;

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

const DOCKER_TIMEOUT_MS = 5000;

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

// publishedPort finds where a container port is published on this host, or null when it is not.
export function publishedPort(ports: Raw | undefined, containerPort: number): { host: string; port: number } | null {
  const bindings = ports?.[`${containerPort}/tcp`];
  if (!Array.isArray(bindings) || bindings.length === 0) return null;
  const list = bindings as Array<{ HostIp?: string; HostPort?: string }>;
  const b = list.find((x) => !x.HostIp || ["0.0.0.0", "127.0.0.1", "::"].includes(x.HostIp)) ?? list[0];
  const host = !b.HostIp || b.HostIp === "0.0.0.0" || b.HostIp === "::" ? "127.0.0.1" : b.HostIp;
  const port = Number(b.HostPort);
  return Number.isInteger(port) && port > 0 ? { host, port } : null;
}

// candidateFromContainer turns one inspect record into a candidate, or null when it is not a published database.
export function candidateFromContainer(info: Raw): DatabaseCandidate | null {
  const config = (info.Config ?? {}) as Raw;
  const image = typeof config.Image === "string" ? config.Image : "";
  const engine = engineFromImage(image);
  if (!engine) return null;
  const network = (info.NetworkSettings ?? {}) as Raw;
  const published = publishedPort(network.Ports as Raw | undefined, engine.port);
  if (!published) return null;
  const env = Array.isArray(config.Env) ? (config.Env as string[]) : [];
  const name = typeof info.Name === "string" ? info.Name.replace(/^\//, "") : image;
  return { engine: engine.engine, ...published, source: "docker", label: `${name} (${image})`, container: name, ...credentialsFromEnv(engine.engine, env) };
}

// dockerExec runs the docker CLI with a short timeout.
export const dockerExec: DockerExec = (args) =>
  new Promise((resolve, reject) => {
    execFile("docker", args, { timeout: DOCKER_TIMEOUT_MS, maxBuffer: 16 * 1024 * 1024 }, (err, stdout) => {
      if (err) reject(err);
      else resolve(String(stdout));
    });
  });

// discoverDockerDatabases lists the running containers and returns the databases published to this host.
export async function discoverDockerDatabases(exec: DockerExec = dockerExec): Promise<DatabaseCandidate[]> {
  const ids = (await exec(["ps", "-q"])).split("\n").map((s) => s.trim()).filter(Boolean);
  if (ids.length === 0) return [];
  const infos = JSON.parse(await exec(["inspect", ...ids])) as Raw[];
  return infos.map(candidateFromContainer).filter((c): c is DatabaseCandidate => c !== null);
}
