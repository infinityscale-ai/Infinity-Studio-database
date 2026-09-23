import { spawn } from "node:child_process";
import type { OciProfile } from "../../lib/oci/oci-database";
import { OciApiError } from "./api";
import { findOciBinary, summarizeStderr } from "./cli";
import { signInCommand, type OciCredentialProfile } from "./profiles";
import { isTokenLive, readSessionToken } from "./session-token";

/** Whether a profile's session token is usable right now, and until when. */
export type SessionValidity = { valid: boolean; until: string | null };

const LOGIN_TIMEOUT_MS = 5 * 60_000;

// sessionValidity reads the profile's token file; API-key profiles are always usable.
export function sessionValidity(profile: OciCredentialProfile): SessionValidity {
  if (!profile.sessionAuth) return { valid: true, until: null };
  const token = readSessionToken(profile.tokenFile);
  const until = token?.expiresAt ? new Date(token.expiresAt).toISOString().replace("T", " ").slice(0, 16) + " UTC" : null;
  return { valid: isTokenLive(token), until };
}

// requireLiveSession refuses to go on with an expired or missing sign-in, naming the command that fixes it.
export function requireLiveSession(profile: OciCredentialProfile): void {
  if (!profile.sessionAuth) return;
  const token = readSessionToken(profile.tokenFile);
  if (isTokenLive(token)) return;
  const state = token ? `has expired` : `is missing on this computer`;
  throw new OciApiError("not-signed-in", `Your Oracle Cloud sign-in for ${profile.name} ${state}. Run: ${signInCommand(profile)}`);
}

// authenticateInBrowser runs `oci session authenticate`, which opens the system browser for the user to sign in.
export function authenticateInBrowser(profile: OciProfile, binary: string | null = findOciBinary()): Promise<void> {
  if (!binary) return Promise.reject(new OciApiError("not-signed-in", `Sign in on this computer. Run: ${signInCommand(profile)}`));
  const args = ["session", "authenticate", "--profile-name", profile.name, "--region", profile.region];
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, { stdio: ["pipe", "pipe", "pipe"] });
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new OciApiError("failed", "Signing in to Oracle Cloud took too long. Finish the browser login and try again."));
    }, LOGIN_TIMEOUT_MS);
    child.stderr.on("data", (chunk) => (stderr += String(chunk)));
    child.stdout.on("data", (chunk) => {
      if (/\[y\/N\]|overwrite/i.test(String(chunk))) child.stdin.write("y\n");
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(new OciApiError("failed", err.message));
    });
    child.on("exit", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new OciApiError("failed", summarizeStderr(stderr)));
    });
  });
}
