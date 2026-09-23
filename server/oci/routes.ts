import type { Express, Request, Response } from "express";
import type { OciBastionAnswer, OciConnectRequest, OciDatabaseKind, OciDatabaseSummary, OciProfile, OciStatus, OciTunnelResult } from "../../lib/oci/oci-database";
import { clientFor, OciApiError, type OciClient } from "./api";
import { bastionName, createBastion, createPortForwardingSession, findBastion, tunnelConnectionString, type DatabaseLogin } from "./bastion";
import { findOciBinary } from "./cli";
import { describeDatabase, listDatabases } from "./inventory";
import { publicProfile, readCredentialProfiles, type OciCredentialProfile } from "./profiles";
import { authenticateInBrowser, sessionValidity, signInCommand } from "./session-login";
import { generateSessionKeyPair, type SshKeyPair } from "./ssh-keypair";

/** How the routes reach the machine and the cloud; injected so tests never touch either. */
export type OciRouteDeps = {
  profiles: () => OciCredentialProfile[];
  client: (profile: OciCredentialProfile) => OciClient;
  cliBinary: () => string | null;
  login: (profile: OciProfile, binary: string | null) => Promise<void>;
  keyPair: () => Promise<SshKeyPair>;
};

/** A request the routes refuse, with the status to say so. */
class RouteError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly code: string,
  ) {
    super(message);
  }
}

const DEFAULT_DEPS: OciRouteDeps = {
  profiles: () => readCredentialProfiles(),
  client: clientFor,
  cliBinary: () => findOciBinary(),
  login: authenticateInBrowser,
  keyPair: generateSessionKeyPair,
};

const KINDS: ReadonlySet<string> = new Set<OciDatabaseKind>(["mysql", "postgres", "autonomous"]);

// statusOf reports the sign-in files found, whether the browser sign-in can run here, and each session's validity.
function statusOf(deps: OciRouteDeps): OciStatus {
  const profiles = deps.profiles().map((p) => {
    const v = sessionValidity(p);
    return { ...publicProfile(p), sessionValid: p.sessionAuth ? v.valid : null, validUntil: v.until };
  });
  return { configured: profiles.length > 0, cliAvailable: deps.cliBinary() !== null, profiles };
}

// profileNamed finds the profile a request names, or refuses it.
function profileNamed(deps: OciRouteDeps, name: unknown): OciCredentialProfile {
  const profile = typeof name === "string" ? deps.profiles().find((p) => p.name === name) : undefined;
  if (!profile) throw new RouteError(400, "Unknown OCI profile.", "oci_profile_unknown");
  return profile;
}

// summaryFrom validates the database summary a request carries.
function summaryFrom(value: unknown): OciDatabaseSummary {
  const v = (value ?? {}) as Record<string, unknown>;
  const ok = typeof v.id === "string" && typeof v.kind === "string" && KINDS.has(v.kind) && typeof v.name === "string" && typeof v.compartmentId === "string";
  if (!ok) throw new RouteError(400, "The request does not name a database.", "oci_database_invalid");
  return { id: v.id as string, kind: v.kind as OciDatabaseKind, name: v.name as string, state: typeof v.state === "string" ? v.state : "", compartmentId: v.compartmentId as string };
}

// loginFrom validates the database login a request carries.
function loginFrom(value: unknown): DatabaseLogin {
  const v = (value ?? {}) as Record<string, unknown>;
  const username = typeof v.username === "string" ? v.username.trim() : "";
  const password = typeof v.password === "string" ? v.password : "";
  if (!username || !password) throw new RouteError(400, "A database username and password are required.", "oci_login_missing");
  return { username, password, database: typeof v.database === "string" ? v.database.trim() : "" };
}

// prepareBastion resolves a database's private endpoint and the bastion for its VCN, creating one only when asked.
async function prepareBastion(deps: OciRouteDeps, body: Record<string, unknown>): Promise<OciBastionAnswer> {
  const client = deps.client(profileNamed(deps, body.profile));
  const target = await describeDatabase(client, summaryFrom(body.database));
  if (!target.privateIp) throw new RouteError(409, "This database has no private endpoint the studio can reach through a bastion.", "oci_no_private_endpoint");
  let bastion = await findBastion(client, target.compartmentId, target.vcnId);
  if (!bastion && body.create === true) {
    const cidrs = Array.isArray(body.clientCidrs) ? body.clientCidrs.filter((c): c is string => typeof c === "string") : undefined;
    bastion = await createBastion(client, { compartmentId: target.compartmentId, subnetId: target.subnetId, name: bastionName(target), clientCidrs: cidrs });
  }
  return { target, bastion };
}

// openTunnel opens a bastion session to the database and returns the connection string that goes through it.
async function openTunnel(deps: OciRouteDeps, body: Record<string, unknown>): Promise<OciTunnelResult> {
  const request: OciConnectRequest = { profile: String(body.profile ?? ""), database: summaryFrom(body.database), login: loginFrom(body.login) };
  const client = deps.client(profileNamed(deps, request.profile));
  const target = await describeDatabase(client, request.database);
  if (target.engine === "oracle") throw new RouteError(409, "Autonomous Database through a bastion is not supported yet; use its wallet with the JDBC connection.", "oci_engine_unsupported");
  if (!target.privateIp) throw new RouteError(409, "This database has no private endpoint the studio can reach through a bastion.", "oci_no_private_endpoint");
  const bastion = await findBastion(client, target.compartmentId, target.vcnId);
  if (!bastion) throw new RouteError(409, "No active bastion targets this database's network. Create one first.", "oci_bastion_missing");
  const keys = await deps.keyPair();
  const session = await createPortForwardingSession(client, { bastionId: bastion.id, target, publicKey: keys.publicKey });
  return { connectionString: tunnelConnectionString(target, session, keys.privateKey, request.login), expiresAt: session.expiresAt, sessionId: session.sessionId, target };
}

// statusFor maps a failure to the HTTP status and code the panel keys its next step on.
function statusFor(err: unknown): { status: number; code: string; message: string } {
  if (err instanceof RouteError) return { status: err.status, code: err.code, message: err.message };
  if (err instanceof OciApiError) {
    const status = err.kind === "session-expired" || err.kind === "not-signed-in" ? 401 : 502;
    return { status, code: `oci_${err.kind.replace(/-/g, "_")}`, message: err.message };
  }
  return { status: 500, code: "oci_failed", message: (err as Error)?.message || "The Oracle Cloud request failed." };
}

// handle wraps a route body: its result goes out as data, its failure as a coded error with the right status.
function handle(body: (req: Request) => Promise<unknown>) {
  return async (req: Request, res: Response) => {
    try {
      res.json({ success: true, data: await body(req) });
    } catch (err) {
      const failure = statusFor(err);
      res.status(failure.status).json({ success: false, error: failure.message, code: failure.code });
    }
  };
}

// mountOciRoutes adds the OCI endpoints; the caller never mounts them in embed mode, and they sit behind the access key.
export function mountOciRoutes(app: Express, deps: OciRouteDeps = DEFAULT_DEPS): void {
  app.get("/api/oci/status", handle(async () => statusOf(deps)));
  app.post("/api/oci/login", handle(async (req) => {
    const profile = profileNamed(deps, (req.body ?? {}).profile);
    const binary = deps.cliBinary();
    if (!binary) throw new RouteError(409, `Sign in on your computer with: ${signInCommand(profile)}`, "oci_cli_missing");
    await deps.login(publicProfile(profile), binary);
    return { ok: true };
  }));
  app.get("/api/oci/databases", handle((req) => listDatabases(deps.client(profileNamed(deps, req.query.profile)))));
  app.post("/api/oci/bastion", handle((req) => prepareBastion(deps, req.body ?? {})));
  app.post("/api/oci/connect", handle((req) => openTunnel(deps, req.body ?? {})));
}
