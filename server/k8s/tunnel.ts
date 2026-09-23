import net from "node:net";
import type { ChildProcess } from "node:child_process";
import { clientFor } from "../oci/api";
import { readCredentialProfiles, type OciCredentialProfile } from "../oci/profiles";
import { findKubectl, KubectlMissingError, runKubectl, spawnPortForward } from "./kubectl";
import { readServerAndCa, writeKubeconfig, type KubeconfigFile } from "./kubeconfig";
import { mintOkeToken } from "./oke-token";
import { relayPodManifest, relayPodName, RELAY_PORT, type RelayTarget } from "./relay-pod";

/** What the caller must say to open a tunnel into a cluster. */
export type KubeTunnelRequest = { profileName: string; clusterId: string; namespace: string; target: RelayTarget };

/** A live tunnel: the local port to connect to, and the way to take it all down. */
export type KubeTunnel = { localPort: number; podName: string; close: () => Promise<void> };

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
async function prepareKubeconfig(profile: OciCredentialProfile, clusterId: string): Promise<KubeconfigFile> {
  const yaml = await clientFor(profile).getClusterKubeconfig(clusterId);
  const { server, caData } = readServerAndCa(yaml);
  return writeKubeconfig({ server, caData, token: mintOkeToken(profile, clusterId) });
}

// teardown removes everything a tunnel made, in the order that leaves nothing behind.
async function teardown(binary: string, config: KubeconfigFile, namespace: string, pod: string, child: ChildProcess | null): Promise<void> {
  child?.kill();
  try {
    await runKubectl(binary, config.path, ["-n", namespace, "delete", "pod", pod, "--ignore-not-found", "--wait=false"]);
  } finally {
    config.remove();
  }
}

// openKubeTunnel runs one throwaway relay pod in the cluster and forwards its port to this machine.
export async function openKubeTunnel(request: KubeTunnelRequest): Promise<KubeTunnel> {
  const binary = findKubectl();
  if (!binary) throw new KubectlMissingError();
  const profile = profileNamed(request.profileName);
  const config = await prepareKubeconfig(profile, request.clusterId);
  const podName = relayPodName();
  let child: ChildProcess | null = null;
  try {
    const manifest = JSON.stringify(relayPodManifest(podName, request.target));
    await runKubectl(binary, config.path, ["-n", request.namespace, "create", "-f", "-"], manifest);
    await runKubectl(binary, config.path, ["-n", request.namespace, "wait", "--for=condition=Ready", `pod/${podName}`, `--timeout=${READY_TIMEOUT}`]);
    const localPort = await freePort();
    child = await spawnPortForward(binary, config.path, ["-n", request.namespace, "port-forward", `pod/${podName}`, `${localPort}:${RELAY_PORT}`, "--address", "127.0.0.1"], `127.0.0.1:${localPort}`);
    return { localPort, podName, close: () => teardown(binary, config, request.namespace, podName, child) };
  } catch (err) {
    await teardown(binary, config, request.namespace, podName, child).catch(() => {});
    throw err;
  }
}
