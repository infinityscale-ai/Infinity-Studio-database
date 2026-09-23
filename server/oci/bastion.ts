import type { OciBastion, OciDatabaseTarget } from "../../lib/oci/oci-database";
import { OciApiError, type ApiRecord, type OciClient } from "./api";
import { num, rec, str } from "./inventory";

/** A live port-forwarding session and the SSH endpoint it is reached through. */
export type BastionSession = { sessionId: string; sshHost: string; sshUser: string; sshPort: number; expiresAt: number };

/** What a new bastion needs. */
export type CreateBastionInput = { compartmentId: string; subnetId: string; name: string; clientCidrs?: string[] };

/** What a port-forwarding session needs. */
export type CreateSessionInput = { bastionId: string; target: OciDatabaseTarget; publicKey: string; ttlSeconds?: number };

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
export function toBastion(raw: ApiRecord): OciBastion {
  return { id: str(raw, "id"), name: str(raw, "name"), state: str(raw, "lifecycleState"), vcnId: str(raw, "targetVcnId"), subnetId: str(raw, "targetSubnetId"), compartmentId: str(raw, "compartmentId") };
}

// findBastion returns an active bastion of the compartment that targets the VCN, or null.
export async function findBastion(client: OciClient, compartmentId: string, vcnId: string): Promise<OciBastion | null> {
  const all = (await client.listBastions(compartmentId)).map(toBastion);
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
async function waitForState(get: () => Promise<ApiRecord>, wanted: string, timeoutMs: number, what: string): Promise<ApiRecord> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const raw = await get();
    const state = str(raw, "lifecycleState");
    if (state === wanted) return raw;
    if (/FAILED|DELET/.test(state)) throw new OciApiError("failed", `${what} ended in state ${state}.`);
    if (Date.now() > deadline) throw new OciApiError("failed", `${what} did not become ${wanted} in time.`);
    await sleep(POLL_MS);
  }
}

// createBastionBody is the request that creates a standard bastion on the target's subnet.
export function createBastionBody(input: CreateBastionInput): ApiRecord {
  return {
    bastionType: "STANDARD",
    name: input.name,
    compartmentId: input.compartmentId,
    targetSubnetId: input.subnetId,
    clientCidrBlockAllowList: input.clientCidrs?.length ? input.clientCidrs : DEFAULT_CLIENT_CIDRS,
    maxSessionTtlInSeconds: MAX_SESSION_TTL_SECONDS,
  };
}

// createBastion creates a standard bastion on the target's subnet and waits until it is active.
export async function createBastion(client: OciClient, input: CreateBastionInput): Promise<OciBastion> {
  const id = str(await client.createBastion(createBastionBody(input)), "id");
  if (!id) throw new OciApiError("failed", "Oracle Cloud did not return the new bastion.");
  return toBastion(await waitForState(() => client.getBastion(id), "ACTIVE", BASTION_READY_TIMEOUT_MS, "The bastion"));
}

// createSessionBody is the request that opens a port-forwarding session to the target's private endpoint.
export function createSessionBody(input: CreateSessionInput): ApiRecord {
  const ttl = Math.min(input.ttlSeconds ?? MAX_SESSION_TTL_SECONDS, MAX_SESSION_TTL_SECONDS);
  return {
    bastionId: input.bastionId,
    displayName: `infinity-studio-${input.target.name}`.replace(/[^a-z0-9_.-]/gi, "-").slice(0, 100),
    keyType: "PUB",
    keyDetails: { publicKeyContent: input.publicKey },
    targetResourceDetails: { sessionType: "PORT_FORWARDING", targetResourcePrivateIpAddress: input.target.privateIp, targetResourcePort: input.target.port },
    sessionTtlInSeconds: ttl,
  };
}

// parseSshCommand reads user, host and port out of the ssh command OCI suggests for a session.
export function parseSshCommand(command: string): { sshUser: string; sshHost: string; sshPort: number } | null {
  const at = command.split(/\s+/).find((t) => t.includes("@") && !t.startsWith("-"));
  if (!at) return null;
  const [sshUser, sshHost] = at.split("@");
  const port = /-p\s+(\d+)/.exec(command);
  return { sshUser, sshHost, sshPort: port ? Number(port[1]) : 22 };
}

// sessionEndpoint reads where to ssh from a ready session: its own metadata first, else the regional bastion host.
export function sessionEndpoint(ready: ApiRecord, id: string, region: string): { sshUser: string; sshHost: string; sshPort: number } {
  const parsed = parseSshCommand(str(rec(ready, "sshMetadata"), "command"));
  if (parsed) return parsed;
  return { sshUser: str(ready, "bastionUserName") || id, sshHost: `host.bastion.${region}.oci.oraclecloud.com`, sshPort: 22 };
}

// createPortForwardingSession opens a session to the target's private endpoint and waits until it is active.
export async function createPortForwardingSession(client: OciClient, input: CreateSessionInput): Promise<BastionSession> {
  const body = createSessionBody(input);
  const id = str(await client.createSession(body), "id");
  if (!id) throw new OciApiError("failed", "Oracle Cloud did not return the new bastion session.");
  const ready = await waitForState(() => client.getSession(id), "ACTIVE", SESSION_READY_TIMEOUT_MS, "The bastion session");
  const ttl = num(ready, "sessionTtlInSeconds", body.sessionTtlInSeconds as number);
  return { sessionId: id, ...sessionEndpoint(ready, id, client.region), expiresAt: Date.now() + ttl * 1000 };
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
