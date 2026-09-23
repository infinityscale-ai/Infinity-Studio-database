import { describe, expect, test } from "bun:test";
import { buildKubeConnectionString, readKubeTunnelParams, stripKubeParams } from "../../lib/db/kube-tunnel";
import { readServerAndCa, renderKubeconfig } from "../../server/k8s/kubeconfig";
import { buildOkeToken, clusterRequestUrl } from "../../server/k8s/oke-token";
import { relayPodManifest, RELAY_IMAGE, RELAY_PORT } from "../../server/k8s/relay-pod";

const identity = (s: string) => s;

describe("the OKE token", () => {
  test("is the presigned cluster URL, base64url encoded", () => {
    const url = clusterRequestUrl("af-casablanca-1", "ocid1.cluster.x");
    expect(url).toBe("https://containerengine.af-casablanca-1.oraclecloud.com/cluster_request/ocid1.cluster.x");
    const token = buildOkeToken(url, 'Signature keyId="ST$t"', "Tue, 23 Sep 2026 15:00:00 GMT");
    const decoded = new URL(Buffer.from(token, "base64url").toString("utf8"));
    expect(decoded.pathname).toBe("/cluster_request/ocid1.cluster.x");
    expect(decoded.searchParams.get("authorization")).toContain("Signature");
    expect(decoded.searchParams.get("date")).toBe("Tue, 23 Sep 2026 15:00:00 GMT");
  });
});

describe("the kubeconfig", () => {
  test("keeps the cluster's server and authority and authenticates with a token", () => {
    const yaml = "clusters:\n- cluster:\n    server: https://1.2.3.4:6443\n    certificate-authority-data: QUJD\n";
    expect(readServerAndCa(yaml)).toEqual({ server: "https://1.2.3.4:6443", caData: "QUJD" });
    const rendered = renderKubeconfig({ server: "https://1.2.3.4:6443", caData: "QUJD", token: "tok" });
    expect(rendered).toContain("server: https://1.2.3.4:6443");
    expect(rendered).toContain("certificate-authority-data: QUJD");
    expect(rendered).toContain("token: tok");
    expect(rendered).not.toContain("exec:");
  });
  test("a kubeconfig without a server is refused", () => {
    expect(() => readServerAndCa("clusters: []")).toThrow(/no API server/);
  });
});

describe("the relay pod", () => {
  test("is one pod that forwards a single port and nothing else", () => {
    const m = relayPodManifest("infinity-studio-tunnel-abc123", { host: "10.0.10.111", port: 3306 }) as Record<string, any>;
    expect(m.kind).toBe("Pod");
    expect(m.spec.automountServiceAccountToken).toBe(false);
    expect(m.spec.restartPolicy).toBe("Never");
    expect(m.spec.containers).toHaveLength(1);
    expect(m.spec.containers[0].image).toBe(RELAY_IMAGE);
    expect(RELAY_IMAGE.startsWith("docker.io/")).toBe(true);
    expect(m.spec.containers[0].args).toEqual([`TCP-LISTEN:${RELAY_PORT},fork,reuseaddr`, "TCP:10.0.10.111:3306"]);
    expect(m.spec.containers[0].securityContext.capabilities.drop).toEqual(["ALL"]);
    expect(m.spec.volumes).toBeUndefined();
  });
});

describe("the connection string", () => {
  test("carries the cluster route and gives it back", () => {
    const cs = buildKubeConnectionString("mysql://admin:p%40ss@10.0.10.111:3306/shop", { profile: "laprophan", cluster: "ocid1.cluster.x", namespace: "default" });
    expect(readKubeTunnelParams(cs, identity)).toEqual({ profile: "laprophan", cluster: "ocid1.cluster.x", namespace: "default" });
    const url = new URL(cs);
    expect(url.hostname).toBe("10.0.10.111");
    expect(decodeURIComponent(url.password)).toBe("p@ss");
  });
  test("a plain connection string asks for no tunnel", () => {
    expect(readKubeTunnelParams("mysql://u:p@127.0.0.1:3306/db", identity)).toBeNull();
    expect(readKubeTunnelParams("not a url", identity)).toBeNull();
  });
  test("the routing parameters never reach the driver", () => {
    const cs = buildKubeConnectionString("postgresql://u:p@10.0.10.110:5432/postgres?sslmode=require", { profile: "p", cluster: "c", namespace: "ns" });
    expect([...stripKubeParams(new URL(cs)).searchParams.keys()]).toEqual(["sslmode"]);
  });
});
