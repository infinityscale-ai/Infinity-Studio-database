import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { requireLiveSession } from "../../server/oci/session-login";
import type { OciCredentialProfile } from "../../server/oci/profiles";

// tokenFile writes a JWT-shaped session token expiring at the given time and returns its path.
function tokenFile(expSeconds: number): string {
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "infstudio-token-")), "token");
  fs.writeFileSync(file, `${b64({ alg: "RS256" })}.${b64({ exp: expSeconds })}.sig`);
  return file;
}

const BASE: OciCredentialProfile = { name: "laprophan", region: "af-casablanca-1", tenancy: "t", sessionAuth: true, user: "", fingerprint: "", keyFile: "/k", tokenFile: null, passPhrase: null };
const NOW = Math.floor(Date.now() / 1000);

describe("requireLiveSession", () => {
  test("an expired session is refused with the command that renews it", () => {
    expect(() => requireLiveSession({ ...BASE, tokenFile: tokenFile(NOW - 60) })).toThrow("has expired. Run: oci session authenticate --profile-name laprophan --region af-casablanca-1");
  });
  test("a missing session says so, with the same command", () => {
    expect(() => requireLiveSession({ ...BASE, tokenFile: "/nowhere/token" })).toThrow("is missing on this computer. Run: oci session authenticate");
  });
  test("a live session and an API-key profile go through", () => {
    expect(() => requireLiveSession({ ...BASE, tokenFile: tokenFile(NOW + 3600) })).not.toThrow();
    expect(() => requireLiveSession({ ...BASE, sessionAuth: false })).not.toThrow();
  });
});
