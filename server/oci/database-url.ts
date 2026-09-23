import { TLS_CA_PARAM, TLS_SERVERNAME_PARAM, TLS_VERIFY_PARAM } from "../../lib/db/tls-params";
import { OCI_DATABASE_PARAM, type OciDatabaseTarget } from "../../lib/oci/oci-database";
import type { PostgresTls } from "./inventory";

/** The database login the user typed. */
export type DatabaseLogin = { username: string; password: string; database: string };

// tlsParams chooses how the connection is encrypted: PostgreSQL verified against Oracle's CA, MySQL encrypted.
export function tlsParams(target: OciDatabaseTarget, pgTls: PostgresTls | null): URLSearchParams {
  const params = new URLSearchParams();
  if (target.engine === "mysql") {
    params.set("sslmode", "require");
    params.set(TLS_VERIFY_PARAM, "0");
    return params;
  }
  if (pgTls?.caCertificate && pgTls.fqdn) {
    params.set("sslmode", "verify-full");
    params.set(TLS_CA_PARAM, Buffer.from(pgTls.caCertificate, "utf8").toString("base64"));
    params.set(TLS_SERVERNAME_PARAM, pgTls.fqdn);
    return params;
  }
  params.set("sslmode", "require");
  return params;
}

// databaseUrl is the connection string for a database's own private address, before the cluster route is added.
export function databaseUrl(target: OciDatabaseTarget, login: DatabaseLogin, pgTls: PostgresTls | null): string {
  const scheme = target.engine === "mysql" ? "mysql" : "postgresql";
  const auth = `${encodeURIComponent(login.username)}:${encodeURIComponent(login.password)}@`;
  const db = login.database ? `/${encodeURIComponent(login.database)}` : "";
  const params = tlsParams(target, pgTls);
  params.set(OCI_DATABASE_PARAM, target.id);
  return `${scheme}://${auth}${target.privateIp}:${target.port}${db}?${params.toString()}`;
}
