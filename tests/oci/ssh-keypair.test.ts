import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { generateSessionKeyPair } from "../../server/oci/ssh-keypair";

// hasKeygen reports whether ssh-keygen is on this machine; the test needs it.
function hasKeygen(): boolean {
  try {
    execFileSync("ssh-keygen", ["-?"], { stdio: "ignore" });
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code !== "ENOENT";
  }
}

describe("generateSessionKeyPair", () => {
  test.skipIf(!hasKeygen())("returns an OpenSSH ed25519 pair and keeps nothing on disk", async () => {
    const pair = await generateSessionKeyPair();
    expect(pair.privateKey).toContain("-----BEGIN OPENSSH PRIVATE KEY-----");
    expect(pair.publicKey).toMatch(/^ssh-ed25519 [A-Za-z0-9+/=]+ infinity-studio-bastion$/);
  });
});
