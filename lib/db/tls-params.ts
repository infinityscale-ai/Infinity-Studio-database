/** Base64 PEM of the CA a client verifies the server against. */
export const TLS_CA_PARAM = "infstudio_tls_ca";
/** The name the server certificate must carry when the connection goes to a local tunnel port. */
export const TLS_SERVERNAME_PARAM = "infstudio_tls_servername";
/** "0" asks for an encrypted connection without certificate verification (MySQL's own REQUIRED mode). */
export const TLS_VERIFY_PARAM = "infstudio_tls_verify";

/** What a connection string says about verifying the server's certificate. */
export type TlsParams = { ca: string | null; servername: string | null; verify: boolean };

// decodeCa turns the base64 parameter back into PEM text, or null when it is missing or not base64.
function decodeCa(value: string | null): string | null {
  if (!value) return null;
  try {
    const pem = Buffer.from(value, "base64").toString("utf8");
    return pem.includes("BEGIN CERTIFICATE") ? pem : null;
  } catch {
    return null;
  }
}

// readTlsParams reads the studio's TLS parameters from a connection string's query; verification stays on unless asked off.
export function readTlsParams(search: URLSearchParams): TlsParams {
  return {
    ca: decodeCa(search.get(TLS_CA_PARAM)),
    servername: search.get(TLS_SERVERNAME_PARAM) || null,
    verify: search.get(TLS_VERIFY_PARAM) !== "0",
  };
}
