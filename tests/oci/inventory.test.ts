import { describe, expect, test } from "bun:test";
import type { ApiRecord, OciClient } from "../../server/oci/api";
import { describeDatabase, listDatabases, summarizeSearchItem } from "../../server/oci/inventory";

const MYSQL_RAW = { displayName: "Preprod_DB", lifecycleState: "ACTIVE", mysqlVersion: "8.4.11", subnetId: "ocid1.subnet.oc1..s1", endpoints: [{ ipAddress: "10.0.10.111", port: 3306, portX: 33060 }] };
const PG_RAW = { displayName: "postgres-db", lifecycleState: "ACTIVE", dbVersion: "16.13", adminUsername: "admin", networkDetails: { subnetId: "ocid1.subnet.oc1..s2", primaryDbEndpointPrivateIp: "10.0.10.110" } };
const SUBNET_RAW = { vcnId: "ocid1.vcn.oc1..v1", cidrBlock: "10.0.10.0/24" };

// fakeClient answers the inventory's calls from fixtures and records what was asked.
function fakeClient(over: Partial<OciClient> = {}): OciClient & { calls: string[] } {
  const calls: string[] = [];
  const rec = (name: string, value: ApiRecord) => async (id: string) => {
    calls.push(`${name} ${id}`);
    return value;
  };
  return {
    calls,
    region: "af-casablanca-1",
    search: async (q) => {
      calls.push(`search ${q}`);
      return [];
    },
    getMysqlDbSystem: rec("mysql", MYSQL_RAW),
    getPostgresDbSystem: rec("postgres", PG_RAW),
    getAutonomousDatabase: rec("adb", { dbName: "adb1", dbVersion: "23ai" }),
    getSubnet: rec("subnet", SUBNET_RAW),
    listBastions: async () => [],
    getBastion: rec("bastion", {}),
    createBastion: async () => ({}),
    createSession: async () => ({}),
    getSession: rec("session", {}),
    ...over,
  };
}

describe("summarizeSearchItem", () => {
  test("keeps live databases and drops deleted ones", () => {
    expect(summarizeSearchItem("mysql", { identifier: "id1", displayName: "DB_Prod", lifecycleState: "ACTIVE", compartmentId: "c1" })).toEqual({ id: "id1", kind: "mysql", name: "DB_Prod", state: "ACTIVE", compartmentId: "c1" });
    expect(summarizeSearchItem("mysql", { identifier: "id2", lifecycleState: "DELETED" })).toBeNull();
  });
});

describe("listDatabases", () => {
  test("searches every kind and sorts by name", async () => {
    const client = fakeClient({
      search: async (q) => (q.includes("mysqldbsystem") ? [{ identifier: "m1", displayName: "Preprod_DB", lifecycleState: "ACTIVE", compartmentId: "c" }] : q.includes("postgresqldbsystem") ? [{ identifier: "p1", displayName: "postgres-db", lifecycleState: "ACTIVE", compartmentId: "c" }] : []),
    });
    const list = await listDatabases(client);
    expect(list.map((d) => d.name)).toEqual(["postgres-db", "Preprod_DB"].sort((a, b) => a.localeCompare(b)));
  });
});

describe("describeDatabase", () => {
  test("a MySQL DB System exposes its first endpoint and the VCN of its subnet", async () => {
    const client = fakeClient();
    const t = await describeDatabase(client, { id: "m1", kind: "mysql", name: "Preprod_DB", state: "ACTIVE", compartmentId: "c" });
    expect(t).toMatchObject({ engine: "mysql", privateIp: "10.0.10.111", port: 3306, subnetId: "ocid1.subnet.oc1..s1", vcnId: "ocid1.vcn.oc1..v1", version: "8.4.11", adminUser: "" });
    expect(client.calls).toEqual(["mysql m1", "subnet ocid1.subnet.oc1..s1"]);
  });
  test("an OCI PostgreSQL system exposes its primary private IP and admin user", async () => {
    const t = await describeDatabase(fakeClient(), { id: "p1", kind: "postgres", name: "postgres-db", state: "ACTIVE", compartmentId: "c" });
    expect(t).toMatchObject({ engine: "postgres", privateIp: "10.0.10.110", port: 5432, adminUser: "admin", dbName: "postgres", subnetId: "ocid1.subnet.oc1..s2" });
  });
  test("an Autonomous Database without a private endpoint has no address to tunnel to", async () => {
    const t = await describeDatabase(fakeClient(), { id: "a1", kind: "autonomous", name: "adb1", state: "AVAILABLE", compartmentId: "c" });
    expect(t).toMatchObject({ engine: "oracle", privateIp: "", port: 1522, adminUser: "ADMIN", dbName: "adb1", vcnId: "" });
  });
});
