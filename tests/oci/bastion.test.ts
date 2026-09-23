import { describe, expect, test } from "bun:test";
import { bastionName, findBastion, parseSshCommand, toBastion, tunnelConnectionString, type BastionSession } from "../../server/oci/bastion";
import type { OciRunner } from "../../server/oci/cli";
import type { OciDatabaseTarget } from "../../lib/oci/oci-database";

const TARGET: OciDatabaseTarget = { id: "m1", kind: "mysql", name: "Preprod_DB", state: "ACTIVE", compartmentId: "c", engine: "mysql", privateIp: "10.0.10.111", port: 3306, subnetId: "ocid1.subnet.oc1.af-casablanca-1.aaaa7maemq", vcnId: "v1", adminUser: "", dbName: "", version: "8.4.11" };
const SESSION: BastionSession = { sessionId: "ocid1.bastionsession.oc1..s", sshHost: "host.bastion.af-casablanca-1.oci.oraclecloud.com", sshUser: "ocid1.bastionsession.oc1..s", sshPort: 22, expiresAt: 1 };

describe("findBastion", () => {
  test("picks the active bastion of the VCN and ignores others", async () => {
    const run: OciRunner = async () => [
      { id: "b1", name: "old", "lifecycle-state": "DELETED", "target-vcn-id": "v1" },
      { id: "b2", name: "other", "lifecycle-state": "ACTIVE", "target-vcn-id": "v2" },
      { id: "b3", name: "mine", "lifecycle-state": "ACTIVE", "target-vcn-id": "v1", "target-subnet-id": "s", "compartment-id": "c" },
    ];
    expect(await findBastion(run, "c", "v1")).toEqual(toBastion({ id: "b3", name: "mine", "lifecycle-state": "ACTIVE", "target-vcn-id": "v1", "target-subnet-id": "s", "compartment-id": "c" }));
    expect(await findBastion(run, "c", "v9")).toBeNull();
  });
});

describe("bastionName", () => {
  test("is letters and digits only", () => {
    expect(bastionName(TARGET)).toMatch(/^InfinityStudio[A-Za-z0-9]+$/);
  });
});

describe("parseSshCommand", () => {
  test("reads user, host and port from OCI's suggested command", () => {
    const cmd = "ssh -i <privateKey> -N -L <localPort>:10.0.10.111:3306 -p 22 ocid1.bastionsession.oc1..abc@host.bastion.af-casablanca-1.oci.oraclecloud.com";
    expect(parseSshCommand(cmd)).toEqual({ sshUser: "ocid1.bastionsession.oc1..abc", sshHost: "host.bastion.af-casablanca-1.oci.oraclecloud.com", sshPort: 22 });
    expect(parseSshCommand("")).toBeNull();
  });
});

describe("tunnelConnectionString", () => {
  test("a MySQL target tunnels through the session with the private key inline", () => {
    const cs = tunnelConnectionString(TARGET, SESSION, "-----BEGIN OPENSSH PRIVATE KEY-----\nabc\n-----END OPENSSH PRIVATE KEY-----\n", { username: "admin", password: "p@ss", database: "" });
    const url = new URL(cs);
    expect(url.protocol).toBe("mysql:");
    expect(url.hostname).toBe("10.0.10.111");
    expect(url.port).toBe("3306");
    expect(url.username).toBe("admin");
    expect(decodeURIComponent(url.password)).toBe("p@ss");
    expect(url.searchParams.get("infstudio_ssh_mode")).toBe("ssh");
    expect(url.searchParams.get("infstudio_ssh_user")).toBe(SESSION.sshUser);
    expect(url.searchParams.get("infstudio_ssh_host")).toBe(SESSION.sshHost);
    expect(url.searchParams.get("infstudio_ssh_auth")).toBe("private-key");
    expect(url.searchParams.get("infstudio_ssh_private_key")).toContain("BEGIN OPENSSH PRIVATE KEY");
    expect(url.searchParams.get("sslmode")).toBeNull();
  });
  test("a PostgreSQL target requires TLS and names its database", () => {
    const cs = tunnelConnectionString({ ...TARGET, engine: "postgres", port: 5432 }, SESSION, "k", { username: "admin", password: "x", database: "postgres" });
    const url = new URL(cs);
    expect(url.protocol).toBe("postgresql:");
    expect(url.pathname).toBe("/postgres");
    expect(url.searchParams.get("sslmode")).toBe("require");
  });
});
