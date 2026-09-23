import { describe, expect, test } from "bun:test";
import { closeAllTunnels, getOrOpenTunnel, tunnelKey } from "../../server/k8s/tunnel-registry";
import { RELAY_IMAGE, RELAY_MAX_LIFETIME_SECONDS, relayPodManifest } from "../../server/k8s/relay-pod";
import type { KubeTunnel } from "../../server/k8s/tunnel";

const PREPROD = { clusterId: "ocid1.cluster.preprod", namespace: "default", host: "10.0.10.111", port: 3306 };

// fakeTunnel stands in for a real relay, counts how often it was closed, and can be made to go away on its own.
function fakeTunnel(podName: string, state: { opened: number; closed: string[] }, gone: Promise<void> = new Promise(() => {})): KubeTunnel {
  state.opened += 1;
  return { localPort: 40000 + state.opened, podName, close: async () => void state.closed.push(podName), closed: gone };
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

  test("a relay that goes away on its own is forgotten, so the next call opens a fresh one", async () => {
    await closeAllTunnels();
    const state = { opened: 0, closed: [] as string[] };
    let endFirst: () => void = () => {};
    const firstGone = new Promise<void>((resolve) => (endFirst = resolve));
    await getOrOpenTunnel(PREPROD, () => Promise.resolve(fakeTunnel("relay-1", state, firstGone)));
    endFirst();
    await firstGone;
    await Promise.resolve();
    const next = await getOrOpenTunnel(PREPROD, () => Promise.resolve(fakeTunnel("relay-2", state)));
    expect(next.podName).toBe("relay-2");
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

  test("its image is pinned by digest, so what runs is exactly what was tested", () => {
    expect(RELAY_IMAGE).toMatch(/^docker\.io\/alpine\/socat:[\w.]+@sha256:[0-9a-f]{64}$/);
    const spec = relayPodManifest("relay", { host: "10.0.10.111", port: 3306 }).spec as { containers: Array<{ image: string }> };
    expect(spec.containers[0].image).toBe(RELAY_IMAGE);
  });
});
