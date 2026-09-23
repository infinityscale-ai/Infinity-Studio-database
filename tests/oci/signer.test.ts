import { describe, expect, test } from "bun:test";
import crypto from "node:crypto";
import { apiKeyId, loadPrivateKey, sessionKeyId, signRequest, signingString } from "../../server/oci/signer";

const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
const PEM = privateKey.export({ type: "pkcs8", format: "pem" }) as string;
const NOW = new Date("2026-09-23T15:00:00Z");

// signatureOf pulls the base64 signature and the header list out of an Authorization value.
function signatureOf(authorization: string): { headers: string[]; signature: string } {
  const headers = /headers="([^"]+)"/.exec(authorization)![1].split(" ");
  const signature = /signature="([^"]+)"/.exec(authorization)![1];
  return { headers, signature };
}

describe("key ids", () => {
  test("session tokens are prefixed, api keys are tenancy/user/fingerprint", () => {
    expect(sessionKeyId("abc.def.ghi")).toBe("ST$abc.def.ghi");
    expect(apiKeyId("t", "u", "aa:bb")).toBe("t/u/aa:bb");
  });
});

describe("signRequest", () => {
  test("a GET signs date, request-target and host, and the signature verifies", () => {
    const url = new URL("https://iaas.af-casablanca-1.oraclecloud.com/20160918/subnets/ocid1.subnet.x?x=1");
    const headers = signRequest({ method: "GET", url, body: null, now: NOW }, { keyId: "ST$tok", privateKey: loadPrivateKey(PEM, null) });
    const { headers: signed, signature } = signatureOf(headers.authorization);
    expect(signed).toEqual(["date", "(request-target)", "host"]);
    expect(headers.date).toBe(NOW.toUTCString());
    expect(headers["content-type"]).toBeUndefined();
    const expected = signingString({ date: headers.date, "(request-target)": "get /20160918/subnets/ocid1.subnet.x?x=1", host: url.host }, signed);
    expect(crypto.verify("RSA-SHA256", Buffer.from(expected), publicKey, Buffer.from(signature, "base64"))).toBe(true);
    expect(headers.authorization.startsWith('Signature algorithm="rsa-sha256",headers="date (request-target) host",keyId="ST$tok"')).toBe(true);
  });

  test("a POST also signs content-length, content-type and the body hash", () => {
    const url = new URL("https://query.af-casablanca-1.oci.oraclecloud.com/20180409/resources");
    const body = JSON.stringify({ type: "Structured", query: "query mysqldbsystem resources" });
    const headers = signRequest({ method: "POST", url, body, now: NOW }, { keyId: "ST$tok", privateKey: loadPrivateKey(PEM, null) });
    const { headers: signed, signature } = signatureOf(headers.authorization);
    expect(signed).toEqual(["date", "(request-target)", "host", "content-length", "content-type", "x-content-sha256"]);
    expect(headers["content-length"]).toBe(String(Buffer.byteLength(body)));
    expect(headers["content-type"]).toBe("application/json");
    expect(headers["x-content-sha256"]).toBe(crypto.createHash("sha256").update(body).digest("base64"));
    const values = { date: headers.date, "(request-target)": "post /20180409/resources", host: url.host, "content-length": headers["content-length"], "content-type": "application/json", "x-content-sha256": headers["x-content-sha256"] };
    expect(crypto.verify("RSA-SHA256", Buffer.from(signingString(values, signed)), publicKey, Buffer.from(signature, "base64"))).toBe(true);
  });
});
