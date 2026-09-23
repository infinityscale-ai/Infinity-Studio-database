import type { OciDatabaseKind, OciDatabaseSummary, OciDatabaseTarget } from "../../lib/oci/oci-database";
import type { OciRunner } from "./cli";

/** One CLI record, read field by field. */
type Raw = Record<string, unknown>;

/** The Resource Search type behind each kind. */
const SEARCH_TYPES: Record<OciDatabaseKind, string> = {
  mysql: "mysqldbsystem",
  postgres: "postgresqldbsystem",
  autonomous: "autonomousdatabase",
};

/** Lifecycle states of databases that no longer exist. */
const GONE_STATES = new Set(["DELETED", "DELETING", "TERMINATED", "TERMINATING"]);

/** Which subnet a target sits in, and the VCN around it. */
type SubnetInfo = { subnetId: string; vcnId: string };

// str reads a string field of a record, or an empty string.
export function str(raw: Raw | undefined, key: string): string {
  const v = raw?.[key];
  return typeof v === "string" ? v : "";
}

// num reads a number field of a record, or the fallback.
function num(raw: Raw | undefined, key: string, fallback: number): number {
  const v = raw?.[key];
  return typeof v === "number" ? v : fallback;
}

// rec reads a nested record.
function rec(raw: Raw | undefined, key: string): Raw | undefined {
  const v = raw?.[key];
  return v && typeof v === "object" ? (v as Raw) : undefined;
}

// summarizeSearchItem turns one Resource Search item into a summary, or null when the database is gone.
export function summarizeSearchItem(kind: OciDatabaseKind, item: Raw): OciDatabaseSummary | null {
  const id = str(item, "identifier");
  const state = str(item, "lifecycle-state");
  if (!id || GONE_STATES.has(state)) return null;
  return { id, kind, name: str(item, "display-name") || id, state, compartmentId: str(item, "compartment-id") };
}

// listDatabases searches the whole tenancy for MySQL, PostgreSQL and Autonomous databases, one query per kind.
export async function listDatabases(run: OciRunner): Promise<OciDatabaseSummary[]> {
  const kinds = Object.keys(SEARCH_TYPES) as OciDatabaseKind[];
  const found = await Promise.all(
    kinds.map(async (kind) => {
      const query = `query ${SEARCH_TYPES[kind]} resources`;
      const data = (await run(["search", "resource", "structured-search", "--query-text", query])) as Raw | null;
      const items = Array.isArray(data?.items) ? (data.items as Raw[]) : [];
      return items.map((it) => summarizeSearchItem(kind, it)).filter((x): x is OciDatabaseSummary => x !== null);
    }),
  );
  return found.flat().sort((a, b) => a.name.localeCompare(b.name));
}

// mysqlTarget normalizes a MySQL DB System record; its first endpoint is the private address clients use.
export function mysqlTarget(summary: OciDatabaseSummary, raw: Raw, subnet: SubnetInfo): OciDatabaseTarget {
  const endpoints = Array.isArray(raw.endpoints) ? (raw.endpoints as Raw[]) : [];
  const ep = endpoints[0];
  return { ...summary, ...subnet, engine: "mysql", privateIp: str(ep, "ip-address"), port: num(ep, "port", 3306), adminUser: "", dbName: "", version: str(raw, "mysql-version") };
}

// postgresTarget normalizes an OCI Database with PostgreSQL record; the admin user is part of the record.
export function postgresTarget(summary: OciDatabaseSummary, raw: Raw, subnet: SubnetInfo): OciDatabaseTarget {
  const net = rec(raw, "network-details");
  return { ...summary, ...subnet, engine: "postgres", privateIp: str(net, "primary-db-endpoint-private-ip"), port: 5432, adminUser: str(raw, "admin-username") || "admin", dbName: "postgres", version: str(raw, "db-version") };
}

// autonomousTarget normalizes an Autonomous Database record; only a private endpoint can be reached through a bastion.
export function autonomousTarget(summary: OciDatabaseSummary, raw: Raw, subnet: SubnetInfo): OciDatabaseTarget {
  return { ...summary, ...subnet, engine: "oracle", privateIp: str(raw, "private-endpoint-ip"), port: 1522, adminUser: "ADMIN", dbName: str(raw, "db-name"), version: str(raw, "db-version") };
}

// getArgs picks the CLI command that reads one database record.
function getArgs(summary: OciDatabaseSummary): string[] {
  if (summary.kind === "mysql") return ["mysql", "db-system", "get", "--db-system-id", summary.id];
  if (summary.kind === "postgres") return ["psql", "db-system", "get", "--db-system-id", summary.id];
  return ["db", "autonomous-database", "get", "--autonomous-database-id", summary.id];
}

// subnetIdOf reads the subnet a record sits in; PostgreSQL nests it under network-details.
function subnetIdOf(kind: OciDatabaseKind, raw: Raw): string {
  return kind === "postgres" ? str(rec(raw, "network-details"), "subnet-id") : str(raw, "subnet-id");
}

// describeDatabase fetches one database's record and its subnet, returning where and how to reach it.
export async function describeDatabase(run: OciRunner, summary: OciDatabaseSummary): Promise<OciDatabaseTarget> {
  const raw = ((await run(getArgs(summary))) as Raw | null) ?? {};
  const subnetId = subnetIdOf(summary.kind, raw);
  const subnetRaw = subnetId ? ((await run(["network", "subnet", "get", "--subnet-id", subnetId])) as Raw | null) : null;
  const subnet = { subnetId, vcnId: str(subnetRaw ?? undefined, "vcn-id") };
  if (summary.kind === "mysql") return mysqlTarget(summary, raw, subnet);
  if (summary.kind === "postgres") return postgresTarget(summary, raw, subnet);
  return autonomousTarget(summary, raw, subnet);
}
