import fs from "node:fs";
import type { OciCredentialProfile } from "./profiles";
import { readSessionToken } from "./session-token";
import { apiKeyId, loadPrivateKey, sessionKeyId, signRequest, type SigningIdentity } from "./signer";

/** One JSON record from the API, read field by field. */
export type ApiRecord = Record<string, unknown>;

/** Why an API call failed, in terms the UI can act on. */
export type OciErrorKind = "session-expired" | "not-signed-in" | "failed";

/** The services the studio talks to, keyed by the hostname prefix OCI gives them. */
type Service = "query" | "mysql" | "postgresql" | "database" | "iaas" | "bastion";

/** Hostname shape and API version per service, from the OCI SDK's endpoint templates. */
const SERVICES: Record<Service, { host: (region: string, domain: string) => string; version: string }> = {
  query: { host: (r, d) => `query.${r}.oci.${d}`, version: "20180409" },
  mysql: { host: (r, d) => `mysql.${r}.ocp.${d}`, version: "20190415" },
  postgresql: { host: (r, d) => `postgresql.${r}.oci.${d}`, version: "20220915" },
  database: { host: (r, d) => `database.${r}.${d}`, version: "20160918" },
  iaas: { host: (r, d) => `iaas.${r}.${d}`, version: "20160918" },
  bastion: { host: (r, d) => `bastion.${r}.oci.${d}`, version: "20210331" },
};

/** The commercial realm's domain; other realms set INFSTUDIO_OCI_DOMAIN. */
const DEFAULT_DOMAIN = "oraclecloud.com";
const REQUEST_TIMEOUT_MS = 60_000;

/** Sends one signed request and returns the parsed JSON; injected so tests never reach the network. */
export type OciTransport = (service: Service, method: "GET" | "POST", path: string, body?: unknown) => Promise<unknown>;

/** What inventory and bastion code need from Oracle Cloud. */
export type OciClient = {
  region: string;
  search: (query: string) => Promise<ApiRecord[]>;
  getMysqlDbSystem: (id: string) => Promise<ApiRecord>;
  getPostgresDbSystem: (id: string) => Promise<ApiRecord>;
  getAutonomousDatabase: (id: string) => Promise<ApiRecord>;
  getSubnet: (id: string) => Promise<ApiRecord>;
  listBastions: (compartmentId: string) => Promise<ApiRecord[]>;
  getBastion: (id: string) => Promise<ApiRecord>;
  createBastion: (body: ApiRecord) => Promise<ApiRecord>;
  createSession: (body: ApiRecord) => Promise<ApiRecord>;
  getSession: (id: string) => Promise<ApiRecord>;
};

// OciApiError carries the failure kind so routes can pick a status and the UI a next step.
export class OciApiError extends Error {
  constructor(
    public readonly kind: OciErrorKind,
    message: string,
    public readonly status: number | null = null,
  ) {
    super(message);
    this.name = "OciApiError";
  }
}

// signingIdentity builds the key id and key for a profile: its live session token, or its API key.
export function signingIdentity(profile: OciCredentialProfile): SigningIdentity {
  const pem = fs.readFileSync(profile.keyFile, "utf8");
  const privateKey = loadPrivateKey(pem, profile.passPhrase);
  if (!profile.sessionAuth) return { keyId: apiKeyId(profile.tenancy, profile.user, profile.fingerprint), privateKey };
  const token = readSessionToken(profile.tokenFile);
  if (!token) throw new OciApiError("not-signed-in", "No session token for this profile yet. Sign in first.");
  return { keyId: sessionKeyId(token.token), privateKey };
}

// serviceUrl resolves a service path to its regional endpoint.
export function serviceUrl(service: Service, region: string, path: string, domain: string = DEFAULT_DOMAIN): URL {
  const def = SERVICES[service];
  return new URL(`https://${def.host(region, domain)}/${def.version}${path}`);
}

// errorMessage reads OCI's error body into one line.
function errorMessage(status: number, text: string): string {
  try {
    const parsed = JSON.parse(text) as { code?: string; message?: string };
    return `${parsed.code ?? status}: ${parsed.message ?? text}`.slice(0, 240);
  } catch {
    return `Oracle Cloud answered HTTP ${status}.`;
  }
}

// signedTransport signs and sends requests for one profile over fetch.
export function signedTransport(profile: OciCredentialProfile, domain: string = process.env.INFSTUDIO_OCI_DOMAIN?.trim() || DEFAULT_DOMAIN): OciTransport {
  return async (service, method, path, body) => {
    const identity = signingIdentity(profile);
    const url = serviceUrl(service, profile.region, path, domain);
    const payload = body === undefined ? null : JSON.stringify(body);
    const headers = signRequest({ method, url, body: payload }, identity);
    const res = await fetch(url, { method, headers, body: payload ?? undefined, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    const text = await res.text();
    if (res.status === 401) throw new OciApiError("session-expired", "Oracle Cloud rejected the sign-in; the session has probably expired.", 401);
    if (res.status === 404 && /NotAuthorizedOrNotFound/.test(text)) throw new OciApiError("failed", "Oracle Cloud refused this request: the session may have expired, the sign-in lacks permission, or the resource is gone.", 404);
    if (!res.ok) throw new OciApiError("failed", errorMessage(res.status, text), res.status);
    return text ? JSON.parse(text) : null;
  };
}

// createOciClient exposes the handful of calls the studio makes, over one transport.
export function createOciClient(region: string, send: OciTransport): OciClient {
  const rec = async (p: Promise<unknown>) => ((await p) ?? {}) as ApiRecord;
  const list = async (p: Promise<unknown>) => {
    const v = await p;
    return Array.isArray(v) ? (v as ApiRecord[]) : [];
  };
  return {
    region,
    search: async (query) => list(rec(send("query", "POST", "/resources/actions/search", { type: "Structured", query })).then((r) => r.items)),
    getMysqlDbSystem: (id) => rec(send("mysql", "GET", `/dbSystems/${encodeURIComponent(id)}`)),
    getPostgresDbSystem: (id) => rec(send("postgresql", "GET", `/dbSystems/${encodeURIComponent(id)}`)),
    getAutonomousDatabase: (id) => rec(send("database", "GET", `/autonomousDatabases/${encodeURIComponent(id)}`)),
    getSubnet: (id) => rec(send("iaas", "GET", `/subnets/${encodeURIComponent(id)}`)),
    listBastions: (compartmentId) => list(send("bastion", "GET", `/bastions?compartmentId=${encodeURIComponent(compartmentId)}&limit=100`)),
    getBastion: (id) => rec(send("bastion", "GET", `/bastions/${encodeURIComponent(id)}`)),
    createBastion: (body) => rec(send("bastion", "POST", "/bastions", body)),
    createSession: (body) => rec(send("bastion", "POST", "/sessions", body)),
    getSession: (id) => rec(send("bastion", "GET", `/sessions/${encodeURIComponent(id)}`)),
  };
}

// clientFor builds the real client for a profile.
export function clientFor(profile: OciCredentialProfile): OciClient {
  return createOciClient(profile.region, signedTransport(profile));
}
