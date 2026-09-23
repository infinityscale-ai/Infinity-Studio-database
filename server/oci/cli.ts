import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/** The only job left to the CLI: the browser sign-in, which needs a desktop. */
const PER_USER_DIRS = [".local/bin", "bin"];

// findOciBinary returns the oci executable on PATH or in the usual per-user install dirs, or null.
export function findOciBinary(env: Record<string, string | undefined> = process.env, home: string = os.homedir()): string | null {
  const dirs = (env.PATH || "").split(path.delimiter).filter(Boolean);
  for (const d of PER_USER_DIRS) dirs.push(path.join(home, d));
  const name = process.platform === "win32" ? "oci.exe" : "oci";
  for (const dir of dirs) {
    const candidate = path.join(dir, name);
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

// summarizeStderr keeps one short line of the CLI's complaint for the UI, never the whole dump.
export function summarizeStderr(stderr: string): string {
  const line = stderr.split("\n").map((l) => l.trim()).filter(Boolean).pop();
  return (line || "The OCI CLI command failed.").slice(0, 200);
}
