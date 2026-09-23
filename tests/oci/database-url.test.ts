import { describe, expect, test } from "bun:test";
import { databaseUrl } from "../../server/oci/database-url";
import type { OciDatabaseTarget } from "../../lib/oci/oci-database";

const MYSQL: OciDatabaseTarget = { id: "ocid1.mysqldbsystem.pre", kind: "mysql", name: "Preprod_DB", state: "ACTIVE", compartmentId: "c", engine: "mysql", privateIp: "10.0.10.111", port: 3306, subnetId: "s", vcnId: "v", adminUser: "", dbName: "", version: "8.4.11" };
const PG: OciDatabaseTarget = { ...MYSQL, id: "ocid1.postgresqldbsystem.pg", kind: "postgres", name: "postgres-db", engine: "postgres", privateIp: "10.0.10.110", port: 5432, adminUser: "admin", dbName: "postgres" };
const CA = "-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----\n";
const LOGIN = { username: "app", password: "p@ss/word", database: "shop" };

describe("databaseUrl", () => {
  test("MySQL is encrypted without verification and remembers which Oracle database it is", () => {
    const url = new URL(databaseUrl(MYSQL, LOGIN, null));
    expect(url.protocol).toBe("mysql:");
    expect(`${url.hostname}:${url.port}${url.pathname}`).toBe("10.0.10.111:3306/shop");
    expect(decodeURIComponent(url.password)).toBe("p@ss/word");
    expect(url.searchParams.get("sslmode")).toBe("require");
    expect(url.searchParams.get("infstudio_tls_verify")).toBe("0");
    expect(url.searchParams.get("infstudio_oci_db")).toBe("ocid1.mysqldbsystem.pre");
  });

  test("PostgreSQL is verified in full against Oracle's CA and the endpoint's own name", () => {
    const url = new URL(databaseUrl(PG, { ...LOGIN, database: "" }, { caCertificate: CA, fqdn: "primary.pg.oraclevcn.com" }));
    expect(url.searchParams.get("sslmode")).toBe("verify-full");
    expect(Buffer.from(url.searchParams.get("infstudio_tls_ca") ?? "", "base64").toString("utf8")).toBe(CA);
    expect(url.searchParams.get("infstudio_tls_servername")).toBe("primary.pg.oraclevcn.com");
    expect(url.searchParams.get("infstudio_tls_verify")).toBeNull();
    expect(url.pathname.replace(/^\//, "")).toBe("");
  });

  test("PostgreSQL without published CA details still encrypts", () => {
    const url = new URL(databaseUrl(PG, LOGIN, { caCertificate: "", fqdn: "" }));
    expect(url.searchParams.get("sslmode")).toBe("require");
    expect(url.searchParams.get("infstudio_tls_ca")).toBeNull();
  });
});
