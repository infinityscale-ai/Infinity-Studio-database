import { describe, expect, test } from "bun:test";
import { decodeTokenExpiry, isTokenLive } from "../../server/oci/session-token";

// jwt builds an unsigned token with the given payload, the way the exp check sees one.
function jwt(payload: Record<string, unknown>): string {
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${b64({ alg: "RS256" })}.${b64(payload)}.sig`;
}

describe("session tokens", () => {
  test("exp is read in milliseconds", () => {
    expect(decodeTokenExpiry(jwt({ exp: 1_790_000_000 }))).toBe(1_790_000_000_000);
    expect(decodeTokenExpiry("not-a-jwt")).toBeNull();
    expect(decodeTokenExpiry(jwt({}))).toBeNull();
  });
  test("a token is live until a minute before its expiry", () => {
    const exp = 2_000_000;
    expect(isTokenLive({ token: "t", expiresAt: exp }, exp - 120_000)).toBe(true);
    expect(isTokenLive({ token: "t", expiresAt: exp }, exp - 30_000)).toBe(false);
    expect(isTokenLive({ token: "t", expiresAt: null }, 0)).toBe(true);
    expect(isTokenLive(null)).toBe(false);
  });
});
