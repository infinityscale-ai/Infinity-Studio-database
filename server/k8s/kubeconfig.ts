import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/** What kubectl needs to reach one cluster without any helper program. */
export type KubeAccess = { server: string; caData: string; token: string };

/** A kubeconfig written for one tunnel, removed when the tunnel closes. */
export type KubeconfigFile = { path: string; remove: () => void };

// readServerAndCa pulls the API server URL and its certificate authority out of the kubeconfig OKE returns.
export function readServerAndCa(yaml: string): { server: string; caData: string } {
  const server = /^\s*server:\s*(\S+)\s*$/m.exec(yaml)?.[1] ?? "";
  const caData = /^\s*certificate-authority-data:\s*(\S+)\s*$/m.exec(yaml)?.[1] ?? "";
  if (!server) throw new Error("The cluster's kubeconfig names no API server.");
  return { server, caData };
}

// renderKubeconfig writes a self-contained kubeconfig that authenticates with a static token.
export function renderKubeconfig(access: KubeAccess): string {
  const ca = access.caData ? `    certificate-authority-data: ${access.caData}\n` : "    insecure-skip-tls-verify: true\n";
  return [
    "apiVersion: v1",
    "kind: Config",
    "clusters:",
    "- name: studio",
    "  cluster:",
    `    server: ${access.server}`,
    ca.replace(/\n$/, ""),
    "users:",
    "- name: studio",
    "  user:",
    `    token: ${access.token}`,
    "contexts:",
    "- name: studio",
    "  context:",
    "    cluster: studio",
    "    user: studio",
    "current-context: studio",
    "",
  ].join("\n");
}

// writeKubeconfig puts the rendered kubeconfig in a private temporary file.
export function writeKubeconfig(access: KubeAccess): KubeconfigFile {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "infinity-studio-kube-"));
  const file = path.join(dir, "config");
  fs.writeFileSync(file, renderKubeconfig(access), { mode: 0o600 });
  return { path: file, remove: () => fs.rmSync(dir, { recursive: true, force: true }) };
}
