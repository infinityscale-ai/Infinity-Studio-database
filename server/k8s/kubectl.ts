import { execFile, spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/** Where kubectl lives, or nothing when this machine has none. */
const PER_USER_DIRS = [".local/bin", "bin"];
const RUN_TIMEOUT_MS = 120_000;

// KubectlMissingError says the one external program this route needs is not here.
export class KubectlMissingError extends Error {
  constructor() {
    super("kubectl is not installed where the studio runs, so it cannot open a tunnel into your cluster.");
    this.name = "KubectlMissingError";
  }
}

// findKubectl returns the kubectl executable on PATH or in the usual per-user install dirs, or null.
export function findKubectl(env: Record<string, string | undefined> = process.env, home: string = os.homedir()): string | null {
  const dirs = (env.PATH || "").split(path.delimiter).filter(Boolean);
  for (const d of PER_USER_DIRS) dirs.push(path.join(home, d));
  const name = process.platform === "win32" ? "kubectl.exe" : "kubectl";
  for (const dir of dirs) {
    const candidate = path.join(dir, name);
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

// runKubectl executes one kubectl command against a kubeconfig and returns its stdout.
export function runKubectl(binary: string, kubeconfig: string, args: string[], input?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = execFile(binary, ["--kubeconfig", kubeconfig, ...args], { timeout: RUN_TIMEOUT_MS }, (err, stdout, stderr) => {
      if (err) reject(new Error(String(stderr || err.message).trim().split("\n").pop()?.slice(0, 220) || "kubectl failed."));
      else resolve(String(stdout));
    });
    if (input !== undefined) child.stdin?.end(input);
    else child.stdin?.end();
  });
}

// spawnPortForward starts a long-running port-forward and resolves once it is listening.
export function spawnPortForward(binary: string, kubeconfig: string, args: string[], readyMark: string): Promise<ChildProcess> {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, ["--kubeconfig", kubeconfig, ...args], { stdio: ["ignore", "pipe", "pipe"] });
    let settled = false;
    const fail = (message: string) => {
      if (settled) return;
      settled = true;
      child.kill();
      reject(new Error(message.trim().split("\n").pop()?.slice(0, 220) || "The port-forward did not start."));
    };
    const timer = setTimeout(() => fail("The port-forward did not start in time."), 60_000);
    child.stdout.on("data", (chunk) => {
      if (settled || !String(chunk).includes(readyMark)) return;
      settled = true;
      clearTimeout(timer);
      resolve(child);
    });
    child.stderr.on("data", (chunk) => fail(String(chunk)));
    child.once("error", (err) => fail(err.message));
    child.once("exit", (code) => fail(`The port-forward stopped (${code ?? "signal"}).`));
  });
}
