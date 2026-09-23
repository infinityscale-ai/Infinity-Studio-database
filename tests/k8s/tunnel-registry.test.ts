import { describe, expect, test } from "bun:test";
import { closeAllTunnels, getOrOpenTunnel, tunnelKey } from "../../server/k8s/tunnel-registry";
import { RELAY_MAX_LIFETIME_SECONDS, relayPodManifest } from "../../server/k8s/relay-pod";
import type { KubeTunnel } from "../../server/k8s/tunnel";

const PREPROD = { clusterId: "ocid1.cluster.preprod", namespace: "default", host: "10.0.10.111", port: 3306 };

// fakeTunnel stands in for a real relay and counts how often it was closed.
function fakeTunnel(podName: string, state: { opened: number; closed: string[] }): KubeTunnel {
  state.opened += 1;
  return { localPort: 40000 + state.opened, podName, close: async () => void state.closed.push(podName) };
}

describe("the tunnel registry", () => {
  test("one database gets one relay, however many times it is asked for", async () => {
    await closeAllTunnels();
    const state = { opened: 0, closed: [] as string[] };
    const open = () => Promise.resolve(fakeTunnel("relay-a", state));
    const first = await getOrOpenTunnel(PREPROD, open);
    const second = await getOrOpenTunnel(PREPROD, open);
    expect(state.opened).toBe(1);
    expect(second.localPort).toBe(first.localPort);
    await closeAllTunnels();
    expect(state.closed).toEqual(["relay-a"]);
  });

  test("a different database, namespace or cluster gets its own relay", async () => {
    await closeAllTunnels();
    const state = { opened: 0, closed: [] as string[] };
    const open = () => Promise.resolve(fakeTunnel(`relay-${state.opened + 1}`, state));
    await getOrOpenTunnel(PREPROD, open);
    await getOrOpenTunnel({ ...PREPROD, host: "10.0.10.56" }, open);
    await getOrOpenTunnel({ ...PREPROD, namespace: "apps" }, open);
    await getOrOpenTunnel({ ...PREPROD, clusterId: "ocid1.cluster.prod" }, open);
    expect(state.opened).toBe(4);
    await closeAllTunnels();
    expect(state.closed).toHaveLength(4);
  });

  test("a relay that failed to start is not remembered", async () => {
    await closeAllTunnels();
    const state = { opened: 0, closed: [] as string[] };
    await expect(getOrOpenTunnel(PREPROD, () => Promise.reject(new Error("cluster refused")))).rejects.toThrow("cluster refused");
    const after = await getOrOpenTunnel(PREPROD, () => Promise.resolve(fakeTunnel("relay-b", state)));
    expect(after.podName).toBe("relay-b");
    await closeAllTunnels();
  });

  test("closing one relay lets the next call open a fresh one", async () => {
    await closeAllTunnels();
    const state = { opened: 0, closed: [] as string[] };
    const open = () => Promise.resolve(fakeTunnel(`relay-${state.opened + 1}`, state));
    const tunnel = await getOrOpenTunnel(PREPROD, open);
    await tunnel.close();
    await getOrOpenTunnel(PREPROD, open);
    expect(state.opened).toBe(2);
    await closeAllTunnels();
  });

  test("the key names the cluster, the namespace and the database endpoint", () => {
    expect(tunnelKey(PREPROD)).toBe("ocid1.cluster.preprod|default|10.0.10.111:3306");
  });
});

describe("the relay pod's own limits", () => {
  test("the cluster stops it even if the studio never does", () => {
    const spec = relayPodManifest("relay", { host: "10.0.10.111", port: 3306 }).spec as Record<string, unknown>;
    expect(spec.activeDeadlineSeconds).toBe(RELAY_MAX_LIFETIME_SECONDS);
    expect(spec.restartPolicy).toBe("Never");
    expect(spec.automountServiceAccountToken).toBe(false);
  });

  test("it is labelled so the studio only ever removes its own", () => {
    const meta = relayPodManifest("relay", { host: "10.0.10.111", port: 3306 }).metadata as Record<string, unknown>;
    expect((meta.labels as Record<string, string>)["app.kubernetes.io/managed-by"]).toBe("infinity-studio");
  });
});
