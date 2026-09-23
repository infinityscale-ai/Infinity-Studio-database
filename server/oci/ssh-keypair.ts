import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/** A throwaway SSH key pair for one bastion session. */
export type SshKeyPair = { privateKey: string; publicKey: string };

const KEYGEN_TIMEOUT_MS = 15_000;

// generateSessionKeyPair makes an ed25519 key pair with ssh-keygen and leaves nothing on disk.
export function generateSessionKeyPair(): Promise<SshKeyPair> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "infinity-studio-oci-"));
  const file = path.join(dir, "id_ed25519");
  const args = ["-q", "-t", "ed25519", "-N", "", "-C", "infinity-studio-bastion", "-f", file];
  return new Promise((resolve, reject) => {
    execFile("ssh-keygen", args, { timeout: KEYGEN_TIMEOUT_MS }, (err) => {
      try {
        if (err) throw new Error("ssh-keygen is needed to open a bastion session and was not found on this machine.");
        resolve({ privateKey: fs.readFileSync(file, "utf8"), publicKey: fs.readFileSync(`${file}.pub`, "utf8").trim() });
      } catch (e) {
        reject(e);
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });
  });
}
