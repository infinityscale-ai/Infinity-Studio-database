import type { Express, Request, Response } from "express";
import { buildKubeConnectionString } from "../../lib/db/kube-tunnel";
import type { OciAddressResult, OciStatus } from "../../lib/oci/oci-database";
import { findKubectl } from "../k8s/kubectl";
import { clientFor, OciApiError, type OciClient } from "./api";
import { findOciBinary } from "./cli";
import { databaseUrl, type DatabaseLogin } from "./database-url";
import { resolveAddressRoute, type AddressedDatabase } from "./address-route";
import { readPostgresTls } from "./inventory";
import { publicProfile, readCredentialProfiles, type OciCredentialProfile } from "./profiles";
import { sessionValidity } from "./session-login";

/** How the routes reach the machine and the cloud; injected so tests never touch either. */
export type OciRouteDeps = {
  profiles: () => OciCredentialProfile[];
  client: (profile: OciCredentialProfile) => OciClient;
  cliBinary: () => string | null;
  kubectlBinary: () => string | null;
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
  kubectlBinary: () => findKubectl(),
};

/** Where the throwaway relay pod runs; the user never has to pick one. */
const RELAY_NAMESPACE = "default";

// statusOf reports the sign-in found on this machine, what it can still do, and each session's validity.
function statusOf(deps: OciRouteDeps): OciStatus {
  const profiles = deps.profiles().map((p) => {
    const v = sessionValidity(p);
    return { ...publicProfile(p), sessionValid: p.sessionAuth ? v.valid : null, validUntil: v.until };
  });
  return { configured: profiles.length > 0, cliAvailable: deps.cliBinary() !== null, kubectlAvailable: deps.kubectlBinary() !== null, profiles };
}

// profileNamed finds the profile a request names, or the only one on this computer when it names none.
function profileNamed(deps: OciRouteDeps, name: unknown): OciCredentialProfile {
  const all = deps.profiles();
  const profile = typeof name === "string" && name ? all.find((p) => p.name === name) : all.length === 1 ? all[0] : undefined;
  if (profile) return profile;
  const why = all.length === 0 ? "No Oracle Cloud sign-in was found on this computer (~/.oci/config)." : "Name the Oracle Cloud profile to use.";
  throw new RouteError(400, why, "oci_profile_unknown");
}

// addressFrom validates the database a request types in: engine, private IPv4 address and port.
function addressFrom(body: Record<string, unknown>): AddressedDatabase {
  const engine = body.engine === "postgres" ? "postgres" : body.engine === "mysql" ? "mysql" : null;
  const host = typeof body.host === "string" ? body.host.trim() : "";
  const port = Number(body.port) || (engine === "postgres" ? 5432 : 3306);
  if (!engine) throw new RouteError(400, "Choose MySQL or PostgreSQL.", "oci_engine_invalid");
  if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) throw new RouteError(400, "Host must be the database's private IP address, like 10.0.10.56.", "oci_host_invalid");
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new RouteError(400, "Port must be between 1 and 65535.", "oci_port_invalid");
  return { engine, host, port };
}

// loginFrom validates the database login a request carries.
function loginFrom(value: unknown): DatabaseLogin {
  const v = (value ?? {}) as Record<string, unknown>;
  const username = typeof v.username === "string" ? v.username.trim() : "";
  const password = typeof v.password === "string" ? v.password : "";
  if (!username || !password) throw new RouteError(400, "A database username and password are required.", "oci_login_missing");
  return { username, password, database: typeof v.database === "string" ? v.database.trim() : "" };
}

// connectByAddress turns a typed database into the connection string that reaches it through the user's own cluster.
async function connectByAddress(deps: OciRouteDeps, body: Record<string, unknown>): Promise<OciAddressResult> {
  const wanted = addressFrom(body);
  const login = loginFrom(body);
  const profile = profileNamed(deps, body.profile);
  if (!deps.kubectlBinary()) throw new RouteError(409, "kubectl is not installed where the studio runs, so it cannot open a tunnel into your cluster.", "oci_kubectl_missing");
  const client = deps.client(profile);
  const route = await resolveAddressRoute(client, wanted);
  if (!route) throw new RouteError(404, `No network in your Oracle Cloud tenancy holds ${wanted.host}. Check the host.`, "oci_address_unknown");
  if (!route.cluster) throw new RouteError(409, `None of your Kubernetes clusters sits in the network of ${wanted.host}, so the studio has no way in that adds nothing to Oracle Cloud.`, "oci_no_cluster");
  const pgTls = route.managed && wanted.engine === "postgres" ? await readPostgresTls(client, route.target.id) : null;
  const direct = databaseUrl(route.target, login, pgTls);
  const connectionString = buildKubeConnectionString(direct, { profile: profile.name, cluster: route.cluster.id, namespace: RELAY_NAMESPACE });
  return { connectionString, cluster: route.cluster.name, managedName: route.managed ? route.target.name : null };
}

// statusFor maps a failure to the HTTP status and code the panel keys its next step on.
function statusFor(err: unknown): { status: number; code: string; message: string } {
  if (err instanceof RouteError) return { status: err.status, code: err.code, message: err.message };
  if (err instanceof OciApiError) {
    // 409, never 401: the studio's own client reads every 401 as "this server needs an access key".
    const status = err.kind === "session-expired" || err.kind === "not-signed-in" ? 409 : 502;
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
  app.post("/api/oci/address", handle((req) => connectByAddress(deps, req.body ?? {})));
}
