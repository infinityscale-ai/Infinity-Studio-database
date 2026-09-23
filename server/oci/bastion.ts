import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { OciBastion, OciDatabaseTarget } from "../../lib/oci/oci-database";
import { OciCliError, type OciRunner } from "./cli";
import { str } from "./inventory";

/** One CLI record, read field by field. */
type Raw = Record<string, unknown>;

/** A live port-forwarding session and the SSH endpoint it is reached through. */
export type BastionSession = { sessionId: string; sshHost: string; sshUser: string; sshPort: number; expiresAt: number };

/** What a new bastion needs. */
export type CreateBastionInput = { compartmentId: string; subnetId: string; name: string; clientCidrs?: string[] };

/** What a port-forwarding session needs. */
export type CreateSessionInput = { bastionId: string; target: OciDatabaseTarget; publicKey: string; region: string; ttlSeconds?: number };

/** The login the user typed for the database itself. */
export type DatabaseLogin = { username: string; password: string; database: string };

/** The longest a bastion session may live: three hours. */
export const MAX_SESSION_TTL_SECONDS = 10_800;
const POLL_MS = 3000;
const BASTION_READY_TIMEOUT_MS = 4 * 60_000;
const SESSION_READY_TIMEOUT_MS = 3 * 60_000;
/** Sessions are key-gated, so the bastion may accept SSH from anywhere unless the user narrows it. */
const DEFAULT_CLIENT_CIDRS = ["0.0.0.0/0"];

// toBastion normalizes one bastion record.
export function toBastion(raw: Raw): OciBastion {
  return { id: str(raw, "id"), name: str(raw, "name"), state: str(raw, "lifecycle-state"), vcnId: str(raw, "target-vcn-id"), subnetId: str(raw, "target-subnet-id"), compartmentId: str(raw, "compartment-id") };
}

// findBastion returns an active bastion of the compartment that targets the VCN, or null.
export async function findBastion(run: OciRunner, compartmentId: string, vcnId: string): Promise<OciBastion | null> {
  const data = (await run(["bastion", "bastion", "list", "--compartment-id", compartmentId, "--all"])) as Raw[] | null;
  const all = Array.isArray(data) ? data.map(toBastion) : [];
  return all.find((b) => b.vcnId === vcnId && b.state === "ACTIVE") ?? null;
}

// bastionName derives a name the service accepts (letters and digits only) that ties the bastion to its subnet.
export function bastionName(target: Pick<OciDatabaseTarget, "subnetId">): string {
  return `InfinityStudio${target.subnetId.slice(-8).replace(/[^a-z0-9]/gi, "")}`;
}

// sleep waits between polls.
function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// waitForState polls a record until it reaches the wanted state, failing on a terminal one or at the deadline.
async function waitForState(get: () => Promise<Raw>, wanted: string, timeoutMs: number, what: string): Promise<Raw> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const raw = await get();
    const state = str(raw, "lifecycle-state");
    if (state === wanted) return raw;
    if (/FAILED|DELET/.test(state)) throw new OciCliError("failed", `${what} ended in state ${state}.`);
    if (Date.now() > deadline) throw new OciCliError("failed", `${what} did not become ${wanted} in time.`);
    await sleep(POLL_MS);
  }
}

// createBastion creates a standard bastion on the target's subnet and waits until it is active.
export async function createBastion(run: OciRunner, input: CreateBastionInput): Promise<OciBastion> {
  const cidrs = JSON.stringify(input.clientCidrs?.length ? input.clientCidrs : DEFAULT_CLIENT_CIDRS);
  const args = ["bastion", "bastion", "create", "--bastion-type", "standard", "--compartment-id", input.compartmentId, "--target-subnet-id", input.subnetId, "--name", input.name, "--client-cidr-list", cidrs, "--max-session-ttl", String(MAX_SESSION_TTL_SECONDS)];
  const id = str(((await run(args)) as Raw | null) ?? undefined, "id");
  if (!id) throw new OciCliError("failed", "OCI did not return the new bastion.");
  const ready = await waitForState(async () => ((await run(["bastion", "bastion", "get", "--bastion-id", id])) as Raw) ?? {}, "ACTIVE", BASTION_READY_TIMEOUT_MS, "The bastion");
  return toBastion(ready);
}

// parseSshCommand reads user, host and port out of the ssh command OCI suggests for a session.
export function parseSshCommand(command: string): { sshUser: string; sshHost: string; sshPort: number } | null {
  const at = command.split(/\s+/).find((t) => t.includes("@") && !t.startsWith("-"));
  if (!at) return null;
  const [sshUser, sshHost] = at.split("@");
  const port = /-p\s+(\d+)/.exec(command);
  return { sshUser, sshHost, sshPort: port ? Number(port[1]) : 22 };
}

// createPortForwardingSession opens a session to the target's private endpoint and waits until it is active.
export async function createPortForwardingSession(run: OciRunner, input: CreateSessionInput): Promise<BastionSession> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "infinity-studio-oci-"));
  const pubFile = path.join(dir, "session.pub");
  fs.writeFileSync(pubFile, `${input.publicKey}\n`, { mode: 0o600 });
  try {
    const ttl = Math.min(input.ttlSeconds ?? MAX_SESSION_TTL_SECONDS, MAX_SESSION_TTL_SECONDS);
    const display = `infinity-studio-${input.target.name}`.replace(/[^a-z0-9_.-]/gi, "-").slice(0, 100);
    const args = ["bastion", "session", "create-port-forwarding", "--bastion-id", input.bastionId, "--target-private-ip", input.target.privateIp, "--target-port", String(input.target.port), "--ssh-public-key-file", pubFile, "--session-ttl", String(ttl), "--display-name", display];
    const id = str(((await run(args)) as Raw | null) ?? undefined, "id");
    if (!id) throw new OciCliError("failed", "OCI did not return the new bastion session.");
    const ready = await waitForState(async () => ((await run(["bastion", "session", "get", "--session-id", id])) as Raw) ?? {}, "ACTIVE", SESSION_READY_TIMEOUT_MS, "The bastion session");
    const meta = (ready["ssh-metadata"] ?? {}) as Raw;
    const endpoint = parseSshCommand(str(meta, "command")) ?? { sshUser: id, sshHost: `host.bastion.${input.region}.oci.oraclecloud.com`, sshPort: 22 };
    return { sessionId: id, ...endpoint, expiresAt: Date.now() + ttl * 1000 };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// tunnelConnectionString builds the studio connection string that reaches the target through the session's SSH tunnel.
export function tunnelConnectionString(target: OciDatabaseTarget, session: BastionSession, privateKey: string, login: DatabaseLogin): string {
  const scheme = target.engine === "mysql" ? "mysql" : "postgresql";
  const params = new URLSearchParams({
    infstudio_ssh_mode: "ssh",
    infstudio_ssh_host: session.sshHost,
    infstudio_ssh_port: String(session.sshPort),
    infstudio_ssh_user: session.sshUser,
    infstudio_ssh_auth: "private-key",
    infstudio_ssh_keychain: "0",
    infstudio_ssh_private_key: privateKey,
  });
  if (target.engine === "postgres") params.set("sslmode", "require");
  const auth = login.username ? `${encodeURIComponent(login.username)}:${encodeURIComponent(login.password)}@` : "";
  const db = login.database ? `/${encodeURIComponent(login.database)}` : "";
  return `${scheme}://${auth}${target.privateIp}:${target.port}${db}?${params.toString()}`;
}
