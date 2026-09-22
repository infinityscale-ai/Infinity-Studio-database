import { describe, expect, test } from "bun:test";
import {
  claimEmbedSession,
  describeEmbedEnd,
  readTokenFromHash,
  reasonFromClaimError,
  sessionFromClaim,
  type EmbedEndReason,
} from "../../lib/embed/claim";
import { isEmbedSessionExpired, parseEmbedSession } from "../../lib/embed/session";

const PAYLOAD = {
  session: "emb_abc",
  connectionId: 7,
  externalId: "u1/d1",
  displayName: "Jane",
  expiresAt: 1_800_000_000_000,
  engine: "postgres",
  label: "orders",
  consoleOrigin: "https://console.example",
  theme: null,
};

// Builds a fetcher that answers every call with one status and JSON body, recording the request it saw.
function fakeFetch(status: number, body: unknown) {
  const seen: { url: string; init?: RequestInit }[] = [];
  const fetcher = async (url: string, init?: RequestInit) => {
    seen.push({ url, init });
    return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  };
  return { fetcher, seen };
}

describe("readTokenFromHash", () => {
  test("reads s= out of the fragment and ignores anything else", () => {
    expect(readTokenFromHash("#s=tok_abc")).toBe("tok_abc");
    expect(readTokenFromHash("s=tok_abc&x=1")).toBe("tok_abc");
    expect(readTokenFromHash("#s=%20")).toBeNull();
    expect(readTokenFromHash("#x=1")).toBeNull();
    expect(readTokenFromHash("")).toBeNull();
  });
});

describe("parseEmbedSession / sessionFromClaim", () => {
  test("accepts a complete claim payload and rejects a partial one", () => {
    const session = sessionFromClaim(PAYLOAD, "tok_1");
    expect(session).toEqual({ ...PAYLOAD, session: undefined, bearer: "emb_abc", claimedToken: "tok_1" });
    expect(sessionFromClaim({ ...PAYLOAD, session: undefined }, "tok_1")).toBeNull();
    expect(sessionFromClaim({ ...PAYLOAD, connectionId: "7" }, "tok_1")).toBeNull();
    expect(sessionFromClaim(null, "tok_1")).toBeNull();
    expect(parseEmbedSession("nope")).toBeNull();
  });

  test("keeps the console's theme choice and treats a missing or malformed one as none", () => {
    const theme = { app: "infinityscale", editor: "infinityscale-dark" };
    expect(sessionFromClaim({ ...PAYLOAD, theme }, "tok_1")?.theme).toEqual(theme);
    expect(sessionFromClaim({ ...PAYLOAD, theme: undefined }, "tok_1")?.theme).toBeNull();
    expect(sessionFromClaim({ ...PAYLOAD, theme: { app: "infinityscale" } }, "tok_1")?.theme).toBeNull();
  });

  test("knows when a session has run out", () => {
    const session = sessionFromClaim(PAYLOAD, "tok_1");
    if (!session) throw new Error("expected a session");
    expect(isEmbedSessionExpired(session, PAYLOAD.expiresAt - 1)).toBe(false);
    expect(isEmbedSessionExpired(session, PAYLOAD.expiresAt)).toBe(true);
  });
});

describe("reasonFromClaimError", () => {
  test("keeps the server's typed reasons and folds the rest", () => {
    expect(reasonFromClaimError(410, "token_used")).toBe("token_used");
    expect(reasonFromClaimError(410, "token_expired")).toBe("token_expired");
    expect(reasonFromClaimError(429, "rate_limited")).toBe("rate_limited");
    expect(reasonFromClaimError(400, "token_required")).toBe("rejected");
    expect(reasonFromClaimError(0, undefined)).toBe("unreachable");
  });
});

describe("claimEmbedSession", () => {
  test("posts the token as JSON and returns the stored session shape", async () => {
    const { fetcher, seen } = fakeFetch(200, { success: true, data: PAYLOAD });
    const outcome = await claimEmbedSession("tok_1", fetcher);
    expect(outcome).toEqual({ ok: true, session: { ...PAYLOAD, session: undefined, bearer: "emb_abc", claimedToken: "tok_1" } });
    expect(seen).toHaveLength(1);
    expect(seen[0].url).toBe("/api/embed/claim");
    expect(seen[0].init?.method).toBe("POST");
    expect(seen[0].init?.body).toBe(JSON.stringify({ token: "tok_1" }));
  });

  test("turns a used token, a malformed payload and a network failure into reasons", async () => {
    expect(await claimEmbedSession("tok_1", fakeFetch(410, { success: false, error: "token_used" }).fetcher)).toEqual({ ok: false, reason: "token_used" });
    expect(await claimEmbedSession("tok_1", fakeFetch(200, { success: true, data: { session: "emb_x" } }).fetcher)).toEqual({ ok: false, reason: "rejected" });
    expect(await claimEmbedSession("tok_1", async () => { throw new TypeError("offline"); })).toEqual({ ok: false, reason: "unreachable" });
  });
});

describe("describeEmbedEnd", () => {
  test("has one line for every reason", () => {
    const reasons: EmbedEndReason[] = ["missing", "expired", "token_used", "token_expired", "rate_limited", "revoked", "unreachable", "rejected"];
    const lines = reasons.map(describeEmbedEnd);
    expect(new Set(lines).size).toBe(reasons.length);
    for (const line of lines) expect(line.endsWith(".")).toBe(true);
  });
});
