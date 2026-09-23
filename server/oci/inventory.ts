import type { OciDatabaseKind, OciDatabaseSummary, OciDatabaseTarget } from "../../lib/oci/oci-database";
import type { ApiRecord, OciClient } from "./api";

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
export function str(raw: ApiRecord | undefined, key: string): string {
  const v = raw?.[key];
  return typeof v === "string" ? v : "";
}

// num reads a number field of a record, or the fallback.
export function num(raw: ApiRecord | undefined, key: string, fallback: number): number {
  const v = raw?.[key];
  return typeof v === "number" ? v : fallback;
}

// rec reads a nested record.
export function rec(raw: ApiRecord | undefined, key: string): ApiRecord | undefined {
  const v = raw?.[key];
  return v && typeof v === "object" ? (v as ApiRecord) : undefined;
}

// summarizeSearchItem turns one Resource Search item into a summary, or null when the database is gone.
export function summarizeSearchItem(kind: OciDatabaseKind, item: ApiRecord): OciDatabaseSummary | null {
  const id = str(item, "identifier");
  const state = str(item, "lifecycleState");
  if (!id || GONE_STATES.has(state)) return null;
  return { id, kind, name: str(item, "displayName") || id, state, compartmentId: str(item, "compartmentId") };
}

// listDatabases searches the whole tenancy for MySQL, PostgreSQL and Autonomous databases, one query per kind.
export async function listDatabases(client: OciClient): Promise<OciDatabaseSummary[]> {
  const kinds = Object.keys(SEARCH_TYPES) as OciDatabaseKind[];
  const found = await Promise.all(
    kinds.map(async (kind) => {
      const items = await client.search(`query ${SEARCH_TYPES[kind]} resources`);
      return items.map((it) => summarizeSearchItem(kind, it)).filter((x): x is OciDatabaseSummary => x !== null);
    }),
  );
  return found.flat().sort((a, b) => a.name.localeCompare(b.name));
}

// mysqlTarget normalizes a MySQL DB System record; its first endpoint is the private address clients use.
export function mysqlTarget(summary: OciDatabaseSummary, raw: ApiRecord, subnet: SubnetInfo): OciDatabaseTarget {
  const endpoints = Array.isArray(raw.endpoints) ? (raw.endpoints as ApiRecord[]) : [];
  const ep = endpoints[0];
  return { ...summary, ...subnet, engine: "mysql", privateIp: str(ep, "ipAddress"), port: num(ep, "port", 3306), adminUser: "", dbName: "", version: str(raw, "mysqlVersion") };
}

// postgresTarget normalizes an OCI Database with PostgreSQL record; the admin user is part of the record.
export function postgresTarget(summary: OciDatabaseSummary, raw: ApiRecord, subnet: SubnetInfo): OciDatabaseTarget {
  const net = rec(raw, "networkDetails");
  return { ...summary, ...subnet, engine: "postgres", privateIp: str(net, "primaryDbEndpointPrivateIp"), port: 5432, adminUser: str(raw, "adminUsername") || "admin", dbName: "postgres", version: str(raw, "dbVersion") };
}

// autonomousTarget normalizes an Autonomous Database record; only a private endpoint can be reached through a bastion.
export function autonomousTarget(summary: OciDatabaseSummary, raw: ApiRecord, subnet: SubnetInfo): OciDatabaseTarget {
  return { ...summary, ...subnet, engine: "oracle", privateIp: str(raw, "privateEndpointIp"), port: 1522, adminUser: "ADMIN", dbName: str(raw, "dbName"), version: str(raw, "dbVersion") };
}

// fetchRecord reads one database record with the call that matches its kind.
function fetchRecord(client: OciClient, summary: OciDatabaseSummary): Promise<ApiRecord> {
  if (summary.kind === "mysql") return client.getMysqlDbSystem(summary.id);
  if (summary.kind === "postgres") return client.getPostgresDbSystem(summary.id);
  return client.getAutonomousDatabase(summary.id);
}

// subnetIdOf reads the subnet a record sits in; PostgreSQL nests it under networkDetails.
function subnetIdOf(kind: OciDatabaseKind, raw: ApiRecord): string {
  return kind === "postgres" ? str(rec(raw, "networkDetails"), "subnetId") : str(raw, "subnetId");
}

// describeDatabase fetches one database's record and its subnet, returning where and how to reach it.
export async function describeDatabase(client: OciClient, summary: OciDatabaseSummary): Promise<OciDatabaseTarget> {
  const raw = await fetchRecord(client, summary);
  const subnetId = subnetIdOf(summary.kind, raw);
  const subnet = { subnetId, vcnId: subnetId ? str(await client.getSubnet(subnetId), "vcnId") : "" };
  if (summary.kind === "mysql") return mysqlTarget(summary, raw, subnet);
  if (summary.kind === "postgres") return postgresTarget(summary, raw, subnet);
  return autonomousTarget(summary, raw, subnet);
}

/** What a client needs to verify an OCI PostgreSQL server: its CA and the name its certificate carries. */
export type PostgresTls = { caCertificate: string; fqdn: string };

// readPostgresTls reads the CA and endpoint name Oracle publishes for a PostgreSQL system; a read, nothing more.
export async function readPostgresTls(client: OciClient, dbSystemId: string): Promise<PostgresTls> {
  const details = await client.getPostgresConnectionDetails(dbSystemId);
  return { caCertificate: str(details, "caCertificate"), fqdn: str(rec(details, "primaryDbEndpoint"), "fqdn") };
}
