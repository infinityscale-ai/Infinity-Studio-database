import { describe, expect, test } from "bun:test";
import { readTlsParams } from "../../../lib/db/tls-params";
import { getPgSslConfig } from "../../../lib/db/pg-ssl";

const CA = "-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----\n";
const CA64 = Buffer.from(CA, "utf8").toString("base64");

describe("readTlsParams", () => {
  test("verification stays on unless the string explicitly turns it off", () => {
    expect(readTlsParams(new URLSearchParams("")).verify).toBe(true);
    expect(readTlsParams(new URLSearchParams("infstudio_tls_verify=1")).verify).toBe(true);
    expect(readTlsParams(new URLSearchParams("infstudio_tls_verify=0")).verify).toBe(false);
  });
  test("the CA comes back as PEM, and anything that is not a certificate is ignored", () => {
    expect(readTlsParams(new URLSearchParams(`infstudio_tls_ca=${encodeURIComponent(CA64)}`)).ca).toBe(CA);
    expect(readTlsParams(new URLSearchParams("infstudio_tls_ca=bm90LWEtY2VydA")).ca).toBeNull();
  });
});

describe("getPgSslConfig with a tunnel", () => {
  test("verify-full carries the CA and the name the certificate must match, so it works through 127.0.0.1", async () => {
    const cs = `postgresql://u:p@127.0.0.1:40123/postgres?sslmode=verify-full&infstudio_tls_ca=${encodeURIComponent(CA64)}&infstudio_tls_servername=primary.pg.oraclevcn.com`;
    expect(await getPgSslConfig(cs)).toEqual({ rejectUnauthorized: true, ca: CA, servername: "primary.pg.oraclevcn.com" });
  });
  test("verify-full without studio parameters is unchanged", async () => {
    expect(await getPgSslConfig("postgresql://u:p@db.example.com:5432/x?sslmode=verify-full")).toEqual({ rejectUnauthorized: true });
  });
});
