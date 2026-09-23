import type { Express, Request, Response } from "express";
import type { OciBastionAnswer, OciConnectRequest, OciDatabaseKind, OciDatabaseSummary, OciProfile, OciStatus, OciTunnelResult } from "../../lib/oci/oci-database";
import { bastionName, createBastion, createPortForwardingSession, findBastion, tunnelConnectionString, type DatabaseLogin } from "./bastion";
import { findOciBinary, OciCliError, ociRunner, type OciRunner } from "./cli";
import { describeDatabase, listDatabases } from "./inventory";
import { readOciProfiles } from "./profiles";
import { loginWithBrowser, validateSession } from "./session-login";
import { generateSessionKeyPair, type SshKeyPair } from "./ssh-keypair";

/** How the routes reach the machine and the cloud; injected so tests never touch either. */
export type OciRouteDeps = {
  binary: () => string | null;
  profiles: () => OciProfile[];
  runner: (binary: string, profile: OciProfile) => OciRunner;
  validate: (binary: string, profile: OciProfile) => Promise<{ valid: boolean; until: string | null }>;
  login: (binary: string, profile: OciProfile) => Promise<void>;
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
  binary: () => findOciBinary(),
  profiles: () => readOciProfiles(),
  runner: ociRunner,
  validate: validateSession,
  login: loginWithBrowser,
  keyPair: generateSessionKeyPair,
};

const KINDS: ReadonlySet<string> = new Set<OciDatabaseKind>(["mysql", "postgres", "autonomous"]);

// statusOf reports whether the CLI is here and which profiles exist, with each session's validity.
async function statusOf(deps: OciRouteDeps): Promise<OciStatus> {
  const binary = deps.binary();
  const profiles = binary ? deps.profiles() : [];
  const checked = await Promise.all(
    profiles.map(async (p) => {
      const v = await deps.validate(binary as string, p);
      return { ...p, sessionValid: p.sessionAuth ? v.valid : null, validUntil: v.until };
    }),
  );
  return { installed: binary !== null, profiles: checked };
}

// binaryOrThrow returns the CLI path or refuses the request when it is not installed.
function binaryOrThrow(deps: OciRouteDeps): string {
  const binary = deps.binary();
  if (!binary) throw new RouteError(503, "The OCI CLI (oci) is not installed on this machine.", "oci_not_installed");
  return binary;
}

// profileNamed finds the profile a request names, or refuses it.
function profileNamed(deps: OciRouteDeps, name: unknown): OciProfile {
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
  const profile = profileNamed(deps, body.profile);
  const run = deps.runner(binaryOrThrow(deps), profile);
  const target = await describeDatabase(run, summaryFrom(body.database));
  if (!target.privateIp) throw new RouteError(409, "This database has no private endpoint the studio can reach through a bastion.", "oci_no_private_endpoint");
  let bastion = await findBastion(run, target.compartmentId, target.vcnId);
  if (!bastion && body.create === true) {
    const cidrs = Array.isArray(body.clientCidrs) ? body.clientCidrs.filter((c): c is string => typeof c === "string") : undefined;
    bastion = await createBastion(run, { compartmentId: target.compartmentId, subnetId: target.subnetId, name: bastionName(target), clientCidrs: cidrs });
  }
  return { target, bastion };
}

// openTunnel opens a bastion session to the database and returns the connection string that goes through it.
async function openTunnel(deps: OciRouteDeps, body: Record<string, unknown>): Promise<OciTunnelResult> {
  const request: OciConnectRequest = { profile: String(body.profile ?? ""), database: summaryFrom(body.database), login: loginFrom(body.login) };
  const profile = profileNamed(deps, request.profile);
  const run = deps.runner(binaryOrThrow(deps), profile);
  const target = await describeDatabase(run, request.database);
  if (target.engine === "oracle") throw new RouteError(409, "Autonomous Database through a bastion is not supported yet; use its wallet with the JDBC connection.", "oci_engine_unsupported");
  if (!target.privateIp) throw new RouteError(409, "This database has no private endpoint the studio can reach through a bastion.", "oci_no_private_endpoint");
  const bastion = await findBastion(run, target.compartmentId, target.vcnId);
  if (!bastion) throw new RouteError(409, "No active bastion targets this database's network. Create one first.", "oci_bastion_missing");
  const keys = await deps.keyPair();
  const session = await createPortForwardingSession(run, { bastionId: bastion.id, target, publicKey: keys.publicKey, region: profile.region });
  return { connectionString: tunnelConnectionString(target, session, keys.privateKey, request.login), expiresAt: session.expiresAt, sessionId: session.sessionId, target };
}

// statusFor maps a CLI failure to the HTTP status the panel keys its next step on.
function statusFor(err: unknown): { status: number; code: string; message: string } {
  if (err instanceof RouteError) return { status: err.status, code: err.code, message: err.message };
  if (err instanceof OciCliError) {
    const status = err.kind === "not-installed" ? 503 : err.kind === "session-expired" ? 401 : 502;
    return { status, code: `oci_${err.kind.replace("-", "_")}`, message: err.message };
  }
  return { status: 500, code: "oci_failed", message: (err as Error)?.message || "The OCI request failed." };
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
  app.get("/api/oci/status", handle(() => statusOf(deps)));
  app.post("/api/oci/login", handle(async (req) => {
    const profile = profileNamed(deps, (req.body ?? {}).profile);
    await deps.login(binaryOrThrow(deps), profile);
    return { ok: true };
  }));
  app.get("/api/oci/databases", handle((req) => listDatabases(deps.runner(binaryOrThrow(deps), profileNamed(deps, req.query.profile)))));
  app.post("/api/oci/bastion", handle((req) => prepareBastion(deps, req.body ?? {})));
  app.post("/api/oci/connect", handle((req) => openTunnel(deps, req.body ?? {})));
}
