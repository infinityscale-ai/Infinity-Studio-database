import { spawn } from "node:child_process";
import type { OciProfile } from "../../lib/oci/oci-database";
import { classifyOciFailure, OciCliError, runOciText, summarizeStderr } from "./cli";

/** Whether a profile's session token is usable right now, and until when. */
export type SessionValidity = { valid: boolean; until: string | null };

const VALIDATE_TIMEOUT_MS = 30_000;
const REFRESH_TIMEOUT_MS = 60_000;
const LOGIN_TIMEOUT_MS = 5 * 60_000;

// validateSession asks the CLI whether the profile's session token is still valid; API-key profiles are always usable.
export async function validateSession(binary: string, profile: OciProfile): Promise<SessionValidity> {
  if (!profile.sessionAuth) return { valid: true, until: null };
  try {
    const out = await runOciText(binary, ["session", "validate", "--profile", profile.name, "--region", profile.region, "--auth", "security_token"], VALIDATE_TIMEOUT_MS);
    const until = /valid until\s+(.+)$/im.exec(out)?.[1]?.trim() ?? null;
    return { valid: true, until };
  } catch {
    return { valid: false, until: null };
  }
}

// authenticateInBrowser runs `oci session authenticate`, which opens the system browser for the user to sign in.
function authenticateInBrowser(binary: string, profile: OciProfile): Promise<void> {
  const args = ["session", "authenticate", "--profile-name", profile.name, "--region", profile.region];
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, { stdio: ["pipe", "pipe", "pipe"] });
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new OciCliError("failed", "Signing in to OCI took too long. Finish the browser login and try again."));
    }, LOGIN_TIMEOUT_MS);
    child.stderr.on("data", (chunk) => (stderr += String(chunk)));
    child.stdout.on("data", (chunk) => {
      if (/\[y\/N\]|overwrite/i.test(String(chunk))) child.stdin.write("y\n");
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      const kind = classifyOciFailure(String(err.message), (err as NodeJS.ErrnoException).code ?? null);
      reject(new OciCliError(kind, summarizeStderr(String(err.message), kind)));
    });
    child.on("exit", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new OciCliError("failed", summarizeStderr(stderr, "failed")));
    });
  });
}

// loginWithBrowser refreshes the profile's session when it can, otherwise signs the user in through the browser.
export async function loginWithBrowser(binary: string, profile: OciProfile): Promise<void> {
  try {
    await runOciText(binary, ["session", "refresh", "--profile", profile.name, "--region", profile.region], REFRESH_TIMEOUT_MS);
    if ((await validateSession(binary, profile)).valid) return;
  } catch {
    // A refresh past the token's window fails; the browser login below is the way back in.
  }
  await authenticateInBrowser(binary, profile);
}
