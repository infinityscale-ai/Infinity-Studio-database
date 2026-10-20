import { describe, expect, test } from "bun:test";
import type { ApiRecord, OciClient } from "../../server/oci/api";
import { ipInCidr, ipToNumber, resolveAddressRoute } from "../../server/oci/address-route";

const MYSQL_RAW = { displayName: "Preprod_DB", lifecycleState: "ACTIVE", mysqlVersion: "8.4.11", subnetId: "s1", endpoints: [{ ipAddress: "10.0.10.111", port: 3306 }] };
const SUBNETS: Record<string, ApiRecord> = {
  s1: { id: "s1", vcnId: "v1", cidrBlock: "10.0.10.0/24", compartmentId: "cmp" },
  s2: { id: "s2", vcnId: "v2", cidrBlock: "10.0.16.0/20", compartmentId: "cmp" },
};
const CLUSTER = { id: "c1", name: "Laprophan_Prod", vcnId: "v1", lifecycleState: "ACTIVE", endpoints: { publicEndpoint: "51.170.130.155:6443" } };

// fakeClient answers search, the MySQL record, subnets and clusters from fixtures, and records what was asked.
function fakeClient(): OciClient & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    region: "af-casablanca-1",
    search: async (q) => {
      calls.push(`search ${q}`);
      if (q.includes("mysqldbsystem")) return [{ identifier: "ocid1.mysqldbsystem.pre", displayName: "Preprod_DB", lifecycleState: "ACTIVE", compartmentId: "cmp" }];
      if (q.includes("subnet")) return [{ identifier: "s2" }, { identifier: "s1" }];
      return [];
    },
    getMysqlDbSystem: async () => MYSQL_RAW,
    getPostgresDbSystem: async () => ({}),
    getPostgresConnectionDetails: async () => ({}),
    getAutonomousDatabase: async () => ({}),
    getSubnet: async (id) => SUBNETS[id] ?? {},
    listClusters: async () => [CLUSTER],
    getClusterKubeconfig: async () => "",
  };
}

describe("ipInCidr", () => {
  test("an address inside the block is in, the ones around it are out", () => {
    expect(ipInCidr("10.0.10.56", "10.0.10.0/24")).toBe(true);
    expect(ipInCidr("10.0.11.1", "10.0.10.0/24")).toBe(false);
    expect(ipInCidr("10.0.18.56", "10.0.16.0/20")).toBe(true);
    expect(ipInCidr("10.0.32.1", "10.0.16.0/20")).toBe(false);
  });
  test("anything that is not an IPv4 address or a block is never in", () => {
    expect(ipInCidr("db.internal", "10.0.10.0/24")).toBe(false);
    expect(ipInCidr("10.0.10.300", "10.0.10.0/24")).toBe(false);
    expect(ipInCidr("10.0.10.5", "10.0.10.0/40")).toBe(false);
    expect(ipToNumber("1.2.3")).toBeNull();
  });
});

describe("resolveAddressRoute", () => {
  test("an address Oracle manages uses that database's own record", async () => {
    const route = await resolveAddressRoute(fakeClient(), { engine: "mysql", host: "10.0.10.111", port: 3306 });
    expect(route?.managed).toBe(true);
    expect(route?.target.id).toBe("ocid1.mysqldbsystem.pre");
    expect(route?.cluster?.name).toBe("Laprophan_Prod");
  });
  test("any other private address is placed by the subnet that holds it", async () => {
    const client = fakeClient();
    const route = await resolveAddressRoute(client, { engine: "mysql", host: "10.0.10.56", port: 3306 });
    expect(route?.managed).toBe(false);
    expect(route?.target.id).toBe("");
    expect(route?.target.vcnId).toBe("v1");
    expect(route?.cluster?.id).toBe("c1");
    expect(client.calls).toContain("search query subnet resources");
  });
  test("an address no network holds has no route", async () => {
    expect(await resolveAddressRoute(fakeClient(), { engine: "mysql", host: "192.168.1.5", port: 3306 })).toBeNull();
  });
  test("a PostgreSQL address is never matched to a MySQL system", async () => {
    const route = await resolveAddressRoute(fakeClient(), { engine: "postgres", host: "10.0.10.111", port: 5432 });
    expect(route?.managed).toBe(false);
  });
});
