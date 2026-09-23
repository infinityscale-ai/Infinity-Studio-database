import { describe, expect, test } from "bun:test";
import type { OciClient } from "../../server/oci/api";
import { bastionName, createBastionBody, createSessionBody, findBastion, parseSshCommand, sessionEndpoint, toBastion, tunnelConnectionString, type BastionSession } from "../../server/oci/bastion";
import type { OciDatabaseTarget } from "../../lib/oci/oci-database";

const TARGET: OciDatabaseTarget = { id: "m1", kind: "mysql", name: "Preprod_DB", state: "ACTIVE", compartmentId: "c", engine: "mysql", privateIp: "10.0.10.111", port: 3306, subnetId: "ocid1.subnet.oc1.af-casablanca-1.aaaa7maemq", vcnId: "v1", adminUser: "", dbName: "", version: "8.4.11" };
const SESSION: BastionSession = { sessionId: "ocid1.bastionsession.oc1..s", sshHost: "host.bastion.af-casablanca-1.oci.oraclecloud.com", sshUser: "ocid1.bastionsession.oc1..s", sshPort: 22, expiresAt: 1 };

describe("findBastion", () => {
  test("picks the active bastion of the VCN and ignores others", async () => {
    const client = { listBastions: async () => [
      { id: "b1", name: "old", lifecycleState: "DELETED", targetVcnId: "v1" },
      { id: "b2", name: "other", lifecycleState: "ACTIVE", targetVcnId: "v2" },
      { id: "b3", name: "mine", lifecycleState: "ACTIVE", targetVcnId: "v1", targetSubnetId: "s", compartmentId: "c" },
    ] } as unknown as OciClient;
    expect(await findBastion(client, "c", "v1")).toEqual(toBastion({ id: "b3", name: "mine", lifecycleState: "ACTIVE", targetVcnId: "v1", targetSubnetId: "s", compartmentId: "c" }));
    expect(await findBastion(client, "c", "v9")).toBeNull();
  });
});

describe("request bodies", () => {
  test("a bastion is standard, on the subnet, open to the given CIDRs, with three-hour sessions", () => {
    expect(createBastionBody({ compartmentId: "c", subnetId: "s", name: "InfinityStudioX" })).toEqual({ bastionType: "STANDARD", name: "InfinityStudioX", compartmentId: "c", targetSubnetId: "s", clientCidrBlockAllowList: ["0.0.0.0/0"], maxSessionTtlInSeconds: 10_800 });
    expect(createBastionBody({ compartmentId: "c", subnetId: "s", name: "n", clientCidrs: ["1.2.3.4/32"] }).clientCidrBlockAllowList).toEqual(["1.2.3.4/32"]);
  });
  test("a session forwards one port to the private IP with the given public key", () => {
    const body = createSessionBody({ bastionId: "b", target: TARGET, publicKey: "ssh-ed25519 AAAA x" });
    expect(body).toMatchObject({ bastionId: "b", keyType: "PUB", keyDetails: { publicKeyContent: "ssh-ed25519 AAAA x" }, targetResourceDetails: { sessionType: "PORT_FORWARDING", targetResourcePrivateIpAddress: "10.0.10.111", targetResourcePort: 3306 }, sessionTtlInSeconds: 10_800 });
    expect(String(body.displayName)).toMatch(/^infinity-studio-Preprod_DB$/);
    expect(createSessionBody({ bastionId: "b", target: TARGET, publicKey: "k", ttlSeconds: 99_999 }).sessionTtlInSeconds).toBe(10_800);
  });
});

describe("bastionName", () => {
  test("is letters and digits only", () => {
    expect(bastionName(TARGET)).toMatch(/^InfinityStudio[A-Za-z0-9]+$/);
  });
});

describe("session endpoint", () => {
  test("reads user, host and port from OCI's suggested command", () => {
    const cmd = "ssh -i <privateKey> -N -L <localPort>:10.0.10.111:3306 -p 22 ocid1.bastionsession.oc1..abc@host.bastion.af-casablanca-1.oci.oraclecloud.com";
    expect(parseSshCommand(cmd)).toEqual({ sshUser: "ocid1.bastionsession.oc1..abc", sshHost: "host.bastion.af-casablanca-1.oci.oraclecloud.com", sshPort: 22 });
    expect(parseSshCommand("")).toBeNull();
  });
  test("falls back to the session's user name and the regional bastion host", () => {
    expect(sessionEndpoint({ bastionUserName: "ocid1.bastionsession.oc1..u" }, "id", "af-casablanca-1")).toEqual({ sshUser: "ocid1.bastionsession.oc1..u", sshHost: "host.bastion.af-casablanca-1.oci.oraclecloud.com", sshPort: 22 });
  });
});

describe("tunnelConnectionString", () => {
  test("a MySQL target tunnels through the session with the private key inline", () => {
    const cs = tunnelConnectionString(TARGET, SESSION, "-----BEGIN OPENSSH PRIVATE KEY-----\nabc\n-----END OPENSSH PRIVATE KEY-----\n", { username: "admin", password: "p@ss", database: "" });
    const url = new URL(cs);
    expect(url.protocol).toBe("mysql:");
    expect(url.hostname).toBe("10.0.10.111");
    expect(url.username).toBe("admin");
    expect(decodeURIComponent(url.password)).toBe("p@ss");
    expect(url.searchParams.get("infstudio_ssh_mode")).toBe("ssh");
    expect(url.searchParams.get("infstudio_ssh_user")).toBe(SESSION.sshUser);
    expect(url.searchParams.get("infstudio_ssh_auth")).toBe("private-key");
    expect(url.searchParams.get("infstudio_ssh_private_key")).toContain("BEGIN OPENSSH PRIVATE KEY");
    expect(url.searchParams.get("sslmode")).toBeNull();
  });
  test("a PostgreSQL target requires TLS and names its database", () => {
    const url = new URL(tunnelConnectionString({ ...TARGET, engine: "postgres", port: 5432 }, SESSION, "k", { username: "admin", password: "x", database: "postgres" }));
    expect(url.protocol).toBe("postgresql:");
    expect(url.pathname).toBe("/postgres");
    expect(url.searchParams.get("sslmode")).toBe("require");
  });
});
