import net from "node:net";
import type { ChildProcess } from "node:child_process";
import { clientFor } from "../oci/api";
import { readCredentialProfiles, type OciCredentialProfile } from "../oci/profiles";
import { findKubectl, KubectlMissingError, runKubectl, spawnPortForward } from "./kubectl";
import { readServerAndCa, writeKubeconfig, type KubeconfigFile } from "./kubeconfig";
import { mintOkeToken } from "./oke-token";
import { RELAY_LABEL, relayPodManifest, relayPodName, RELAY_PORT, type RelayTarget } from "./relay-pod";
import { getOrOpenTunnel } from "./tunnel-registry";

/** What the caller must say to open a tunnel into a cluster. */
export type KubeTunnelRequest = { profileName: string; clusterId: string; namespace: string; target: RelayTarget };

/** A live tunnel: the local port to connect to, the way to take it all down, and a signal that settles once it has gone. */
export type KubeTunnel = { localPort: number; podName: string; close: () => Promise<void>; closed: Promise<void> };

/** The kubeconfig of one tunnel, and how to renew its token: OKE tokens last minutes, a relay can live an hour. */
type TunnelKubeconfig = { file: KubeconfigFile; renew: () => void };

const READY_TIMEOUT = "90s";

// freePort asks the operating system for an unused loopback port.
export function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = address && typeof address === "object" ? address.port : 0;
      server.close(() => (port ? resolve(port) : reject(new Error("No free local port for the tunnel."))));
    });
  });
}

// profileNamed finds the signing profile a tunnel request names.
function profileNamed(name: string): OciCredentialProfile {
  const profile = readCredentialProfiles().find((p) => p.name === name);
  if (!profile) throw new Error(`No Oracle Cloud profile named ${name} in this machine's configuration.`);
  return profile;
}

// prepareKubeconfig fetches the cluster's own kubeconfig and rewrites it to authenticate with a freshly minted token.
async function prepareKubeconfig(profile: OciCredentialProfile, clusterId: string): Promise<TunnelKubeconfig> {
  const yaml = await clientFor(profile).getClusterKubeconfig(clusterId);
  const { server, caData } = readServerAndCa(yaml);
  const file = writeKubeconfig({ server, caData, token: mintOkeToken(profile, clusterId) });
  return { file, renew: () => file.rewrite({ server, caData, token: mintOkeToken(profile, clusterId) }) };
}

// teardown removes everything a tunnel made, renewing the token first because the one it opened with has long expired.
async function teardown(binary: string, config: TunnelKubeconfig, namespace: string, pod: string, child: ChildProcess | null): Promise<void> {
  child?.kill();
  try {
    config.renew();
    await runKubectl(binary, config.file.path, ["-n", namespace, "delete", "pod", pod, "--ignore-not-found", "--wait=false"]);
  } finally {
    config.file.remove();
  }
}

// once makes an async action run a single time, however many callers ask for it.
function once(action: () => Promise<void>): () => Promise<void> {
  let running: Promise<void> | null = null;
  return () => (running ??= action());
}

// reapFinishedRelays deletes the studio's own relays that have stopped, so a dead tunnel never lingers as an object.
async function reapFinishedRelays(binary: string, kubeconfig: string, namespace: string): Promise<void> {
  const selector = `${RELAY_LABEL.key}=${RELAY_LABEL.value}`;
  const args = ["-n", namespace, "delete", "pod", "-l", selector, "--field-selector", "status.phase!=Running,status.phase!=Pending", "--ignore-not-found", "--wait=false"];
  await runKubectl(binary, kubeconfig, args).catch(() => {});
}

// openKubeTunnel reuses the relay already serving this database, or starts the one relay it will have.
export function openKubeTunnel(request: KubeTunnelRequest): Promise<KubeTunnel> {
  const key = { clusterId: request.clusterId, namespace: request.namespace, host: request.target.host, port: request.target.port };
  return getOrOpenTunnel(key, () => startKubeTunnel(request));
}

// startKubeTunnel runs one relay pod in the cluster and forwards its port to this machine.
async function startKubeTunnel(request: KubeTunnelRequest): Promise<KubeTunnel> {
  const binary = findKubectl();
  if (!binary) throw new KubectlMissingError();
  const profile = profileNamed(request.profileName);
  const config = await prepareKubeconfig(profile, request.clusterId);
  const podName = relayPodName();
  let child: ChildProcess | null = null;
  try {
    await reapFinishedRelays(binary, config.file.path, request.namespace);
    const manifest = JSON.stringify(relayPodManifest(podName, request.target));
    await runKubectl(binary, config.file.path, ["-n", request.namespace, "create", "-f", "-"], manifest);
    await runKubectl(binary, config.file.path, ["-n", request.namespace, "wait", "--for=condition=Ready", `pod/${podName}`, `--timeout=${READY_TIMEOUT}`]);
    const localPort = await freePort();
    const forward = await spawnPortForward(binary, config.file.path, ["-n", request.namespace, "port-forward", `pod/${podName}`, `${localPort}:${RELAY_PORT}`, "--address", "127.0.0.1"], `127.0.0.1:${localPort}`);
    child = forward;
    const stop = once(() => teardown(binary, config, request.namespace, podName, forward));
    const closed = new Promise<void>((resolve) => forward.once("exit", () => resolve()));
    void closed.then(() => stop()).catch(() => {});
    return { localPort, podName, close: stop, closed };
  } catch (err) {
    await teardown(binary, config, request.namespace, podName, child).catch(() => {});
    throw err;
  }
}
