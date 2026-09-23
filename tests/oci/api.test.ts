import { describe, expect, test } from "bun:test";
import { createOciClient, serviceUrl, type OciTransport } from "../../server/oci/api";

describe("serviceUrl", () => {
  test("follows the SDK's endpoint templates and API versions", () => {
    expect(serviceUrl("query", "af-casablanca-1", "/resources").toString()).toBe("https://query.af-casablanca-1.oci.oraclecloud.com/20180409/resources");
    expect(serviceUrl("mysql", "af-casablanca-1", "/dbSystems/x").toString()).toBe("https://mysql.af-casablanca-1.ocp.oraclecloud.com/20190415/dbSystems/x");
    expect(serviceUrl("postgresql", "af-casablanca-1", "/dbSystems/x").toString()).toBe("https://postgresql.af-casablanca-1.oci.oraclecloud.com/20220915/dbSystems/x");
    expect(serviceUrl("database", "af-casablanca-1", "/autonomousDatabases/x").toString()).toBe("https://database.af-casablanca-1.oraclecloud.com/20160918/autonomousDatabases/x");
    expect(serviceUrl("iaas", "af-casablanca-1", "/subnets/x").toString()).toBe("https://iaas.af-casablanca-1.oraclecloud.com/20160918/subnets/x");
    expect(serviceUrl("bastion", "af-casablanca-1", "/sessions").toString()).toBe("https://bastion.af-casablanca-1.oci.oraclecloud.com/20210331/sessions");
    expect(serviceUrl("iaas", "r", "/x", "oraclegovcloud.com").host).toBe("iaas.r.oraclegovcloud.com");
  });
});

describe("createOciClient", () => {
  test("each call hits the right service, method and path", async () => {
    const calls: Array<[string, string, string, unknown]> = [];
    const send: OciTransport = async (service, method, path, body) => {
      calls.push([service, method, path, body]);
      return path === "/resources" ? { items: [{ identifier: "a" }] } : path.startsWith("/bastions?") ? [{ id: "b" }] : { id: "x" };
    };
    const c = createOciClient("af-casablanca-1", send);
    expect(await c.search("query mysqldbsystem resources")).toEqual([{ identifier: "a" }]);
    expect(await c.listBastions("ocid1.compartment/x")).toEqual([{ id: "b" }]);
    await c.getMysqlDbSystem("m/1");
    await c.getPostgresDbSystem("p");
    await c.getAutonomousDatabase("a");
    await c.getSubnet("s");
    await c.getBastion("b");
    await c.createBastion({ name: "n" });
    await c.createSession({ bastionId: "b" });
    await c.getSession("s1");
    expect(calls.map(([svc, m, p]) => `${svc} ${m} ${p}`)).toEqual([
      "query POST /resources",
      "bastion GET /bastions?compartmentId=ocid1.compartment%2Fx&limit=100",
      "mysql GET /dbSystems/m%2F1",
      "postgresql GET /dbSystems/p",
      "database GET /autonomousDatabases/a",
      "iaas GET /subnets/s",
      "bastion GET /bastions/b",
      "bastion POST /bastions",
      "bastion POST /sessions",
      "bastion GET /sessions/s1",
    ]);
    expect(calls[0][3]).toEqual({ type: "Structured", query: "query mysqldbsystem resources" });
  });
});
