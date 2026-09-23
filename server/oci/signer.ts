import crypto from "node:crypto";

/** Who signs: the key id OCI expects and the private key that proves it. */
export type SigningIdentity = { keyId: string; privateKey: crypto.KeyObject };

/** One request to sign. */
export type SignableRequest = { method: string; url: URL; body: string | null; now?: Date };

/** The headers a signed request must carry. */
export type SignedHeaders = Record<string, string>;

const GENERIC_HEADERS = ["date", "(request-target)", "host"];
const BODY_HEADERS = ["content-length", "content-type", "x-content-sha256"];
const BODY_METHODS = new Set(["POST", "PUT", "PATCH"]);

// sessionKeyId is the key id for a session token: the token itself, prefixed.
export function sessionKeyId(token: string): string {
  return `ST$${token}`;
}

// apiKeyId is the key id for an API key: tenancy, user and fingerprint.
export function apiKeyId(tenancy: string, user: string, fingerprint: string): string {
  return `${tenancy}/${user}/${fingerprint}`;
}

// loadPrivateKey reads a PEM private key, with its passphrase when it has one.
export function loadPrivateKey(pem: string, passphrase: string | null): crypto.KeyObject {
  return crypto.createPrivateKey(passphrase ? { key: pem, passphrase } : pem);
}

// headerValues computes every header that takes part in the signature.
function headerValues(req: SignableRequest): SignedHeaders {
  const headers: SignedHeaders = {
    date: (req.now ?? new Date()).toUTCString(),
    "(request-target)": `${req.method.toLowerCase()} ${req.url.pathname}${req.url.search}`,
    host: req.url.host,
  };
  if (BODY_METHODS.has(req.method.toUpperCase())) {
    const body = req.body ?? "";
    headers["content-length"] = String(Buffer.byteLength(body));
    headers["content-type"] = "application/json";
    headers["x-content-sha256"] = crypto.createHash("sha256").update(body).digest("base64");
  }
  return headers;
}

// signingString joins the signed headers, one per line, in OCI's order.
export function signingString(headers: SignedHeaders, names: string[]): string {
  return names.map((n) => `${n}: ${headers[n]}`).join("\n");
}

// signRequest returns the headers to send: date, content headers when there is a body, and the Signature authorization.
export function signRequest(req: SignableRequest, identity: SigningIdentity): SignedHeaders {
  const values = headerValues(req);
  const names = BODY_METHODS.has(req.method.toUpperCase()) ? [...GENERIC_HEADERS, ...BODY_HEADERS] : GENERIC_HEADERS;
  const signature = crypto.sign("RSA-SHA256", Buffer.from(signingString(values, names), "utf8"), identity.privateKey).toString("base64");
  const out: SignedHeaders = { date: values.date, host: values.host };
  for (const n of BODY_HEADERS) if (values[n] !== undefined) out[n] = values[n];
  out.authorization = `Signature version="1",keyId="${identity.keyId}",algorithm="rsa-sha256",headers="${names.join(" ")}",signature="${signature}"`;
  return out;
}
