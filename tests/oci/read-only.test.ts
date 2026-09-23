import { describe, expect, test } from "bun:test";
import { assertReadOnly, createOciClient, serviceUrl, type OciTransport } from "../../server/oci/api";

describe("assertReadOnly", () => {
  test("every GET is allowed", () => {
    expect(() => assertReadOnly("iaas", "GET", "/subnets/x")).not.toThrow();
  });
  test("the two reads expressed as POST are allowed", () => {
    expect(() => assertReadOnly("query", "POST", "/resources")).not.toThrow();
    expect(() => assertReadOnly("containerengine", "POST", "/clusters/ocid1.cluster.x/kubeconfig/content")).not.toThrow();
  });
  test("anything that could change the tenancy is refused", () => {
    expect(() => assertReadOnly("bastion", "POST", "/bastions")).toThrow(/only reads/);
    expect(() => assertReadOnly("bastion", "POST", "/sessions")).toThrow(/only reads/);
    expect(() => assertReadOnly("containerengine", "POST", "/clusters")).toThrow(/only reads/);
    expect(() => assertReadOnly("iaas", "DELETE", "/subnets/x")).toThrow(/only reads/);
    expect(() => assertReadOnly("iaas", "PUT", "/subnets/x")).toThrow(/only reads/);
  });
});

describe("the client surface", () => {
  test("exposes reads only, and no bastion call survives", async () => {
    const seen: string[] = [];
    const send: OciTransport = async (svc, method, path) => {
      seen.push(`${svc} ${method} ${path}`);
      return path === "/resources" ? { items: [] } : path.endsWith("/kubeconfig/content") ? "apiVersion: v1" : { id: "x" };
    };
    const c = createOciClient("af-casablanca-1", send);
    expect(Object.keys(c).sort()).toEqual(["getAutonomousDatabase", "getClusterKubeconfig", "getMysqlDbSystem", "getPostgresDbSystem", "getSubnet", "listClusters", "region", "search"].sort());
    await c.listClusters("ocid1.tenancy.x");
    await c.getClusterKubeconfig("ocid1.cluster.x");
    expect(seen).toEqual(["containerengine GET /clusters?compartmentId=ocid1.tenancy.x&limit=100", "containerengine POST /clusters/ocid1.cluster.x/kubeconfig/content"]);
  });
  test("the container engine endpoint follows the SDK template", () => {
    expect(serviceUrl("containerengine", "af-casablanca-1", "/clusters").toString()).toBe("https://containerengine.af-casablanca-1.oci.oraclecloud.com/20180222/clusters");
  });
});
