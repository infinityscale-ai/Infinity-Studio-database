import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { OciProfile } from "../../lib/oci/oci-database";

/** Why an OCI CLI call failed, in terms the UI can act on. */
export type OciErrorKind = "not-installed" | "session-expired" | "failed";

/** Runs one CLI command for a bound profile and returns its `data`; injected so tests can fake the CLI. */
export type OciRunner = (args: string[], timeoutMs?: number) => Promise<unknown>;

const DEFAULT_TIMEOUT_MS = 90_000;
const MAX_OUTPUT_BYTES = 32 * 1024 * 1024;
const PER_USER_DIRS = [".local/bin", "bin"];

// OciCliError carries the failure kind so routes can pick a status and the UI a next step.
export class OciCliError extends Error {
  constructor(
    public readonly kind: OciErrorKind,
    message: string,
  ) {
    super(message);
    this.name = "OciCliError";
  }
}

// findOciBinary returns the oci executable on PATH or in the usual per-user install dirs, or null.
export function findOciBinary(env: NodeJS.ProcessEnv = process.env, home: string = os.homedir()): string | null {
  const dirs = (env.PATH || "").split(path.delimiter).filter(Boolean);
  for (const d of PER_USER_DIRS) dirs.push(path.join(home, d));
  const name = process.platform === "win32" ? "oci.exe" : "oci";
  for (const dir of dirs) {
    const candidate = path.join(dir, name);
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

// classifyOciFailure reads everything the CLI said, on both streams, into a failure kind.
export function classifyOciFailure(stderr: string, code: string | number | null): OciErrorKind {
  if (code === "ENOENT") return "not-installed";
  if (/NotAuthenticated|session .*(expired|invalid|is not valid|no longer valid)|security[_ ]token|Unable to load session|re-authenticate|status 401/i.test(stderr)) {
    return "session-expired";
  }
  return "failed";
}

// profileArgs are the flags every command needs for a profile: session-token auth when the profile has one.
export function profileArgs(profile: OciProfile): string[] {
  const args = ["--profile", profile.name, "--region", profile.region, "--output", "json"];
  if (profile.sessionAuth) args.push("--auth", "security_token");
  return args;
}

// summarizeStderr keeps one short line of the CLI's complaint for the UI, never the whole dump.
export function summarizeStderr(stderr: string, kind: OciErrorKind): string {
  if (kind === "not-installed") return "The OCI CLI (oci) is not installed on this machine.";
  if (kind === "session-expired") return "The OCI session for this profile has expired. Sign in again.";
  const line = stderr.split("\n").map((l) => l.trim()).filter(Boolean).pop();
  return (line || "The OCI CLI command failed.").slice(0, 200);
}

// runOci executes the CLI once with stdin closed (so its prompts abort instead of waiting) and returns the parsed `data` field, or null for empty output.
export function runOci(binary: string, args: string[], timeoutMs: number): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const child = execFile(binary, args, { timeout: timeoutMs, maxBuffer: MAX_OUTPUT_BYTES }, (err, stdout, stderr) => {
      if (err) {
        const text = `${String(stdout || "")}\n${String(stderr || err.message)}`;
        const kind = classifyOciFailure(text, (err as NodeJS.ErrnoException).code ?? null);
        return reject(new OciCliError(kind, summarizeStderr(text, kind)));
      }
      const text = String(stdout || "").trim();
      if (!text) return resolve(null);
      try {
        resolve((JSON.parse(text) as { data?: unknown }).data ?? null);
      } catch {
        reject(new OciCliError("failed", "The OCI CLI returned something that is not JSON."));
      }
    });
    child.stdin?.end();
  });
}

// runOciText executes a CLI command that prints text rather than JSON and returns everything it said, on both streams.
export function runOciText(binary: string, args: string[], timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = execFile(binary, args, { timeout: timeoutMs, maxBuffer: MAX_OUTPUT_BYTES }, (err, stdout, stderr) => {
      if (!err) return resolve(`${String(stdout || "")}\n${String(stderr || "")}`);
      const text = `${String(stdout || "")}\n${String(stderr || err.message)}`;
      const kind = classifyOciFailure(text, (err as NodeJS.ErrnoException).code ?? null);
      reject(new OciCliError(kind, summarizeStderr(text, kind)));
    });
    child.stdin?.end();
  });
}

// ociRunner binds the CLI to one binary and profile.
export function ociRunner(binary: string, profile: OciProfile): OciRunner {
  return (args, timeoutMs = DEFAULT_TIMEOUT_MS) => runOci(binary, [...args, ...profileArgs(profile)], timeoutMs);
}
