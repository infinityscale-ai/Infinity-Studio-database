import { describe, expect, test } from "bun:test";
import { describeDatabase, listDatabases, summarizeSearchItem } from "../../server/oci/inventory";
import type { OciRunner } from "../../server/oci/cli";

const MYSQL_RAW = { "display-name": "Preprod_DB", "lifecycle-state": "ACTIVE", "mysql-version": "8.4.11", "subnet-id": "ocid1.subnet.oc1..s1", endpoints: [{ "ip-address": "10.0.10.111", port: 3306, "port-x": 33060 }] };
const PG_RAW = { "display-name": "postgres-db", "lifecycle-state": "ACTIVE", "db-version": "16.13", "admin-username": "admin", "network-details": { "subnet-id": "ocid1.subnet.oc1..s2", "primary-db-endpoint-private-ip": "10.0.10.110" } };
const SUBNET_RAW = { "vcn-id": "ocid1.vcn.oc1..v1", "cidr-block": "10.0.10.0/24" };

// fakeRunner answers CLI calls from a table keyed by the command's first words and records every call.
function fakeRunner(answers: Record<string, unknown>): { run: OciRunner; calls: string[][] } {
  const calls: string[][] = [];
  const run: OciRunner = async (args) => {
    calls.push(args);
    const key = Object.keys(answers).find((k) => args.join(" ").startsWith(k));
    return key ? answers[key] : null;
  };
  return { run, calls };
}

describe("summarizeSearchItem", () => {
  test("keeps live databases and drops deleted ones", () => {
    const live = summarizeSearchItem("mysql", { identifier: "id1", "display-name": "DB_Prod", "lifecycle-state": "ACTIVE", "compartment-id": "c1" });
    expect(live).toEqual({ id: "id1", kind: "mysql", name: "DB_Prod", state: "ACTIVE", compartmentId: "c1" });
    expect(summarizeSearchItem("mysql", { identifier: "id2", "lifecycle-state": "DELETED" })).toBeNull();
  });
});

describe("listDatabases", () => {
  test("searches every kind and sorts by name", async () => {
    const { run, calls } = fakeRunner({
      "search resource structured-search --query-text query mysqldbsystem": { items: [{ identifier: "m1", "display-name": "Preprod_DB", "lifecycle-state": "ACTIVE", "compartment-id": "c" }] },
      "search resource structured-search --query-text query postgresqldbsystem": { items: [{ identifier: "p1", "display-name": "postgres-db", "lifecycle-state": "ACTIVE", "compartment-id": "c" }] },
      "search resource structured-search --query-text query autonomousdatabase": { items: [] },
    });
    const list = await listDatabases(run);
    expect(list.map((d) => d.name)).toEqual(["postgres-db", "Preprod_DB"].sort((a, b) => a.localeCompare(b)));
    expect(calls).toHaveLength(3);
  });
});

describe("describeDatabase", () => {
  test("a MySQL DB System exposes its first endpoint and the VCN of its subnet", async () => {
    const { run } = fakeRunner({ "mysql db-system get": MYSQL_RAW, "network subnet get": SUBNET_RAW });
    const t = await describeDatabase(run, { id: "m1", kind: "mysql", name: "Preprod_DB", state: "ACTIVE", compartmentId: "c" });
    expect(t).toMatchObject({ engine: "mysql", privateIp: "10.0.10.111", port: 3306, subnetId: "ocid1.subnet.oc1..s1", vcnId: "ocid1.vcn.oc1..v1", version: "8.4.11", adminUser: "" });
  });
  test("an OCI PostgreSQL system exposes its primary private IP and admin user", async () => {
    const { run } = fakeRunner({ "psql db-system get": PG_RAW, "network subnet get": SUBNET_RAW });
    const t = await describeDatabase(run, { id: "p1", kind: "postgres", name: "postgres-db", state: "ACTIVE", compartmentId: "c" });
    expect(t).toMatchObject({ engine: "postgres", privateIp: "10.0.10.110", port: 5432, adminUser: "admin", dbName: "postgres", subnetId: "ocid1.subnet.oc1..s2" });
  });
  test("an Autonomous Database without a private endpoint has no address to tunnel to", async () => {
    const { run } = fakeRunner({ "db autonomous-database get": { "db-name": "adb1", "db-version": "23ai" } });
    const t = await describeDatabase(run, { id: "a1", kind: "autonomous", name: "adb1", state: "AVAILABLE", compartmentId: "c" });
    expect(t).toMatchObject({ engine: "oracle", privateIp: "", port: 1522, adminUser: "ADMIN", dbName: "adb1", vcnId: "" });
  });
});
