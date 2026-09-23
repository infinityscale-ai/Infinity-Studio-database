import type { Express, Request, Response } from "express";
import { buildKubeConnectionString } from "../../lib/db/kube-tunnel";
import type { OciConnectRequest, OciDatabaseKind, OciDatabaseSummary, OciDatabaseTarget, OciProfile, OciRouteAnswer, OciStatus, OciTunnelResult } from "../../lib/oci/oci-database";
import { findKubectl } from "../k8s/kubectl";
import { clientFor, OciApiError, type OciClient } from "./api";
import { findOciBinary } from "./cli";
import { findClusterForDatabase, type OkeCluster } from "./clusters";
import { describeDatabase, listDatabases } from "./inventory";
import { publicProfile, readCredentialProfiles, type OciCredentialProfile } from "./profiles";
import { authenticateInBrowser, sessionValidity, signInCommand } from "./session-login";

/** How the routes reach the machine and the cloud; injected so tests never touch either. */
export type OciRouteDeps = {
  profiles: () => OciCredentialProfile[];
  client: (profile: OciCredentialProfile) => OciClient;
  cliBinary: () => string | null;
  kubectlBinary: () => string | null;
  login: (profile: OciProfile, binary: string | null) => Promise<void>;
};

/** The database login the user typed. */
type DatabaseLogin = { username: string; password: string; database: string };

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
  kubectlBinary: () => findKubectl(),
  login: authenticateInBrowser,
};

const KINDS: ReadonlySet<string> = new Set<OciDatabaseKind>(["mysql", "postgres", "autonomous"]);
/** Where the throwaway relay pod runs unless the caller names another namespace. */
const DEFAULT_NAMESPACE = "default";

// statusOf reports the sign-in found on this machine, what it can still do, and each session's validity.
function statusOf(deps: OciRouteDeps): OciStatus {
  const profiles = deps.profiles().map((p) => {
    const v = sessionValidity(p);
    return { ...publicProfile(p), sessionValid: p.sessionAuth ? v.valid : null, validUntil: v.until };
  });
  return { configured: profiles.length > 0, cliAvailable: deps.cliBinary() !== null, kubectlAvailable: deps.kubectlBinary() !== null, profiles };
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

// resolveRoute works out the database's private endpoint and which of the user's clusters can carry the connection.
async function resolveRoute(deps: OciRouteDeps, body: Record<string, unknown>): Promise<OciRouteAnswer> {
  const client = deps.client(profileNamed(deps, body.profile));
  const target = await describeDatabase(client, summaryFrom(body.database));
  if (!target.privateIp) throw new RouteError(409, "This database has no private address the studio can reach.", "oci_no_private_endpoint");
  const cluster = await findClusterForDatabase(client, target);
  return { target, cluster: cluster ? { id: cluster.id, name: cluster.name, publicEndpoint: cluster.publicEndpoint } : null };
}

// directConnectionString is the plain connection string for the database's own private address.
function directConnectionString(target: OciDatabaseTarget, login: DatabaseLogin): string {
  const scheme = target.engine === "mysql" ? "mysql" : "postgresql";
  const auth = `${encodeURIComponent(login.username)}:${encodeURIComponent(login.password)}@`;
  const db = login.database ? `/${encodeURIComponent(login.database)}` : "";
  const query = target.engine === "postgres" ? "?sslmode=require" : "";
  return `${scheme}://${auth}${target.privateIp}:${target.port}${db}${query}`;
}

// buildConnection settles the route and returns the connection string that carries it through the user's own cluster.
async function buildConnection(deps: OciRouteDeps, body: Record<string, unknown>): Promise<OciTunnelResult> {
  const request: OciConnectRequest = { profile: String(body.profile ?? ""), database: summaryFrom(body.database), login: loginFrom(body.login) };
  const profile = profileNamed(deps, request.profile);
  const answer = await resolveRoute(deps, { profile: request.profile, database: request.database });
  if (answer.target.engine === "oracle") throw new RouteError(409, "Autonomous Database is not supported on this route yet; use its wallet with the JDBC connection.", "oci_engine_unsupported");
  if (!answer.cluster) throw new RouteError(409, "None of your Kubernetes clusters sits in this database's network, so the studio has no way in that adds nothing to Oracle Cloud.", "oci_no_cluster");
  if (!deps.kubectlBinary()) throw new RouteError(409, "kubectl is not installed where the studio runs, so it cannot open a tunnel into your cluster.", "oci_kubectl_missing");
  const namespace = typeof body.namespace === "string" && body.namespace.trim() ? body.namespace.trim() : DEFAULT_NAMESPACE;
  const connectionString = buildKubeConnectionString(directConnectionString(answer.target, request.login), { profile: profile.name, cluster: answer.cluster.id, namespace });
  return { connectionString, target: answer.target, cluster: answer.cluster, namespace };
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

// mountOciRoutes adds the Oracle Cloud endpoints. Every call here reads; nothing the studio does creates anything in the tenancy.
export function mountOciRoutes(app: Express, deps: OciRouteDeps = DEFAULT_DEPS): void {
  app.get("/api/oci/status", handle(async () => statusOf(deps)));
  app.post("/api/oci/login", handle(async (req) => {
    const profile = profileNamed(deps, (req.body ?? {}).profile);
    const binary = deps.cliBinary();
    if (!binary) throw new RouteError(409, `Sign in on this computer with: ${signInCommand(profile)}`, "oci_cli_missing");
    await deps.login(publicProfile(profile), binary);
    return { ok: true };
  }));
  app.get("/api/oci/databases", handle((req) => listDatabases(deps.client(profileNamed(deps, req.query.profile)))));
  app.post("/api/oci/route", handle((req) => resolveRoute(deps, req.body ?? {})));
  app.post("/api/oci/connect", handle((req) => buildConnection(deps, req.body ?? {})));
}
