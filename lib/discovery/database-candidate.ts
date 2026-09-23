/** Engines the local detector recognizes; each maps to a studio provider. */
export type CandidateEngine = "postgres" | "mysql" | "mariadb" | "mongodb" | "redis" | "mssql" | "clickhouse" | "oracle";

/** Where a candidate came from. */
export type CandidateSource = "port" | "docker" | "pgpass" | "mycnf";

/** One database the detector believes is reachable from this machine. */
export type DatabaseCandidate = {
  engine: CandidateEngine;
  host: string;
  port: number;
  source: CandidateSource;
  label: string;
  username?: string;
  password?: string;
  database?: string;
  container?: string;
};

/** How each source fared during one scan. */
export type SourceReport = { source: "ports" | "docker" | "files"; status: "ok" | "unavailable" | "error"; detail?: string };

/** The whole answer of one local scan. */
export type DiscoverResult = { candidates: DatabaseCandidate[]; sources: SourceReport[] };

/** The URL scheme the studio expects for each engine. */
const SCHEMES: Record<Exclude<CandidateEngine, "oracle">, string> = {
  postgres: "postgresql",
  mysql: "mysql",
  mariadb: "mariadb",
  mongodb: "mongodb",
  redis: "redis",
  mssql: "mssql",
  clickhouse: "clickhouse",
};

// authPart renders the user:password@ prefix of a URL, or nothing when no user is known.
function authPart(c: DatabaseCandidate): string {
  if (!c.username) return c.password ? `:${encodeURIComponent(c.password)}@` : "";
  const pw = c.password ? `:${encodeURIComponent(c.password)}` : "";
  return `${encodeURIComponent(c.username)}${pw}@`;
}

// candidateConnectionString builds the connection string a candidate prefills, credentials included when known.
export function candidateConnectionString(c: DatabaseCandidate): string {
  if (c.engine === "oracle") {
    const service = c.database || "FREEPDB1";
    const jdbcUrl = `jdbc:oracle:thin:@//${c.host}:${c.port}/${service}`;
    return `jdbc://?jdbcUrl=${encodeURIComponent(jdbcUrl)}&driverClass=oracle.jdbc.OracleDriver`;
  }
  const db = c.database ? `/${encodeURIComponent(c.database)}` : "";
  return `${SCHEMES[c.engine]}://${authPart(c)}${c.host}:${c.port}${db}`;
}

// candidateKey names one endpoint so sources can be merged.
export function candidateKey(c: { host: string; port: number }): string {
  return `${c.host}:${c.port}`;
}

// mergeCandidates keeps one candidate per endpoint, preferring the one that knows credentials.
export function mergeCandidates(lists: DatabaseCandidate[][]): DatabaseCandidate[] {
  const byKey = new Map<string, DatabaseCandidate>();
  for (const c of lists.flat()) {
    const key = candidateKey(c);
    const seen = byKey.get(key);
    if (!seen || (!seen.password && c.password)) byKey.set(key, c);
  }
  return [...byKey.values()].sort((a, b) => a.port - b.port || a.label.localeCompare(b.label));
}
