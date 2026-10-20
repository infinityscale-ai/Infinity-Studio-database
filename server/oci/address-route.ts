import type { OciDatabaseTarget } from "../../lib/oci/oci-database";
import type { ApiRecord, OciClient } from "./api";
import { findClusterForDatabase, type OkeCluster } from "./clusters";
import { describeDatabase, listDatabases, str } from "./inventory";

/** A database the user typed in like an app's .env: its engine and private address. */
export type AddressedDatabase = { engine: "mysql" | "postgres"; host: string; port: number };

/** Where a typed address leads: the database record behind it when Oracle manages it, and the cluster that reaches it. */
export type AddressRoute = { target: OciDatabaseTarget; managed: boolean; cluster: OkeCluster | null };

/** How many subnets are read when looking for the one that holds the address; a tenancy with more is answered as not found. */
const MAX_SUBNETS = 100;
/** How many databases of the typed engine are described when matching the address to one Oracle manages. */
const MAX_DATABASES = 20;

// ipToNumber reads a dotted IPv4 address as a 32-bit number, or null when it is not one.
export function ipToNumber(ip: string): number | null {
  const parts = ip.trim().split(".");
  if (parts.length !== 4 || parts.some((p) => !/^\d{1,3}$/.test(p) || Number(p) > 255)) return null;
  return parts.reduce((acc, p) => acc * 256 + Number(p), 0);
}

// ipInCidr reports whether an IPv4 address sits inside a CIDR block such as 10.0.16.0/20.
export function ipInCidr(ip: string, cidr: string): boolean {
  const [base, bitsText] = cidr.split("/");
  const addr = ipToNumber(ip);
  const start = ipToNumber(base ?? "");
  const bits = Number(bitsText);
  if (addr === null || start === null || !Number.isInteger(bits) || bits < 0 || bits > 32) return false;
  const size = 2 ** (32 - bits);
  const first = Math.floor(start / size) * size;
  return addr >= first && addr < first + size;
}

// findManagedTarget returns the Oracle-managed database answering on this address, so its own TLS settings are used.
async function findManagedTarget(client: OciClient, wanted: AddressedDatabase): Promise<OciDatabaseTarget | null> {
  const sameEngine = (await listDatabases(client)).filter((d) => d.kind === wanted.engine).slice(0, MAX_DATABASES);
  for (const summary of sameEngine) {
    const target = await describeDatabase(client, summary);
    if (target.privateIp === wanted.host.trim()) return target;
  }
  return null;
}

// findSubnetFor finds the subnet whose range holds the address, for a database Oracle does not manage.
async function findSubnetFor(client: OciClient, host: string): Promise<ApiRecord | null> {
  const items = (await client.search("query subnet resources")).slice(0, MAX_SUBNETS);
  for (const item of items) {
    const subnet = await client.getSubnet(str(item, "identifier"));
    if (ipInCidr(host, str(subnet, "cidrBlock"))) return subnet;
  }
  return null;
}

// addressTarget describes a typed address as a target the cluster route and the URL builder understand.
export function addressTarget(wanted: AddressedDatabase, subnet: ApiRecord): OciDatabaseTarget {
  return {
    id: "", kind: wanted.engine, name: wanted.host, state: "", compartmentId: str(subnet, "compartmentId"),
    engine: wanted.engine, privateIp: wanted.host.trim(), port: wanted.port, subnetId: str(subnet, "id"),
    vcnId: str(subnet, "vcnId"), adminUser: "", dbName: "", version: "",
  };
}

// resolveAddressRoute finds the database or subnet behind a typed address and the user's cluster in that network; every call reads.
export async function resolveAddressRoute(client: OciClient, wanted: AddressedDatabase): Promise<AddressRoute | null> {
  const managed = await findManagedTarget(client, wanted);
  if (managed) return { target: managed, managed: true, cluster: await findClusterForDatabase(client, managed) };
  const subnet = await findSubnetFor(client, wanted.host);
  if (!subnet) return null;
  const target = addressTarget(wanted, subnet);
  return { target, managed: false, cluster: await findClusterForDatabase(client, target) };
}
