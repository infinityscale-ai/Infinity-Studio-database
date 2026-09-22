import { describe, expect, test } from "bun:test";
import { createEmbedStore, type MintInput } from "../../server/embed/sessions";

// Builds a mint input for user u1 on db d1 with optional overrides.
function identity(over: Partial<MintInput> = {}): MintInput {
  return {
    connectionId: 7,
    externalId: "u1/d1",
    userId: "u1",
    dbId: "d1",
    displayName: "orders",
    engine: "postgres",
    label: "orders-db",
    ttlSeconds: 3600,
    ...over,
  };
}

// Returns a controllable clock.
function clock(start = 1_700_000_000_000) {
  let t = start;
  return { now: () => t, tick: (ms: number) => { t += ms; } };
}

describe("embed session store", () => {
  test("mints a tok_ token and claims it exactly once", () => {
    const c = clock();
    const store = createEmbedStore({ now: c.now });
    const minted = store.mintToken(identity());
    expect(minted.token.startsWith("tok_")).toBe(true);
    expect(minted.token.length).toBe(4 + 43);
    expect(minted.expiresAt).toBe(c.now() + 60_000);
    const claimed = store.claim(minted.token);
    if ("error" in claimed) throw new Error(claimed.error);
    expect(claimed.bearer.startsWith("emb_")).toBe(true);
    expect(claimed.session.expiresAt).toBe(c.now() + 3_600_000);
    expect(claimed.session.connectionId).toBe(7);
    expect(claimed.session.id).not.toContain(claimed.bearer);
    expect(store.resolve(claimed.bearer)?.id).toBe(claimed.session.id);
    expect(store.claim(minted.token)).toEqual({ error: "token_used" });
  });

  test("a token expires after its ttl and unknown tokens are reported expired", () => {
    const c = clock();
    const store = createEmbedStore({ now: c.now });
    const minted = store.mintToken(identity());
    c.tick(60_000);
    expect(store.claim(minted.token)).toEqual({ error: "token_expired" });
    expect(store.claim("tok_nope")).toEqual({ error: "token_expired" });
  });

  test("tokenTtlSeconds is honoured and capped, and session ttl is capped at a day", () => {
    const c = clock();
    const store = createEmbedStore({ now: c.now });
    expect(store.mintToken(identity({ tokenTtlSeconds: 120 })).expiresAt).toBe(c.now() + 120_000);
    expect(store.mintToken(identity({ tokenTtlSeconds: 9_999 })).expiresAt).toBe(c.now() + 300_000);
    const claimed = store.claim(store.mintToken(identity({ ttlSeconds: 999_999 })).token);
    if ("error" in claimed) throw new Error(claimed.error);
    expect(claimed.session.expiresAt).toBe(c.now() + 86_400_000);
  });

  test("a session expires after its ttl", () => {
    const c = clock();
    const store = createEmbedStore({ now: c.now });
    const claimed = store.claim(store.mintToken(identity({ ttlSeconds: 10 })).token);
    if ("error" in claimed) throw new Error(claimed.error);
    c.tick(9_999);
    expect(store.resolve(claimed.bearer)).not.toBeNull();
    c.tick(1);
    expect(store.resolve(claimed.bearer)).toBeNull();
    expect(store.lookup(claimed.bearer)).toEqual({ ok: false, error: "embed_session_expired" });
    expect(store.lookup("emb_unknown")).toEqual({ ok: false, error: "embed_session_expired" });
  });

  test("revokeByDb / revokeByUser / revokeByExternalId count sessions and unclaimed tokens and drop secrets", () => {
    const store = createEmbedStore();
    store.setSecret(7, { password: "a", options: {} });
    store.setSecret(8, { password: "b", options: {} });
    store.setSecret(9, { password: "c", options: {} });
    const a = store.claim(store.mintToken(identity()).token);
    const b = store.claim(store.mintToken(identity({ connectionId: 8, externalId: "u2/d1", userId: "u2" })).token);
    const pending = store.mintToken(identity({ connectionId: 9, externalId: "u3/d2", userId: "u3", dbId: "d2" }));
    if ("error" in a || "error" in b) throw new Error("claim failed");
    expect(store.revokeByDb("d1")).toBe(2);
    expect(store.revokeByDb("d1")).toBe(0);
    expect(store.lookup(a.bearer)).toEqual({ ok: false, error: "embed_session_revoked" });
    expect(store.lookup(b.bearer)).toEqual({ ok: false, error: "embed_session_revoked" });
    expect(store.getSecret(7)).toBeNull();
    expect(store.getSecret(8)).toBeNull();
    expect(store.getSecret(9)?.password).toBe("c");
    expect(store.revokeByUser("u3")).toBe(1);
    expect(store.claim(pending.token)).toEqual({ error: "token_expired" });
    expect(store.getSecret(9)).toBeNull();
    const d = store.claim(store.mintToken(identity({ connectionId: 10, externalId: "u4/d4", userId: "u4", dbId: "d4" })).token);
    if ("error" in d) throw new Error(d.error);
    expect(store.revokeByExternalId("u4/d4")).toBe(1);
    expect(store.revokeByExternalId("u4/d4")).toBe(0);
  });

  test("revokeSession marks one session and reports 1 then 0", () => {
    const store = createEmbedStore();
    const claimed = store.claim(store.mintToken(identity()).token);
    if ("error" in claimed) throw new Error(claimed.error);
    expect(store.revokeSession(claimed.session.id)).toBe(1);
    expect(store.revokeSession(claimed.session.id)).toBe(0);
    expect(store.revokeSession("missing")).toBe(0);
    expect(store.resolve(claimed.bearer)).toBeNull();
  });

  test("secrets are kept per connection id and can be deleted", () => {
    const store = createEmbedStore();
    expect(store.getSecret(1)).toBeNull();
    store.setSecret(1, { password: "p@ss", options: { sslmode: "require" } });
    expect(store.getSecret(1)).toEqual({ password: "p@ss", options: { sslmode: "require" } });
    store.deleteSecret(1);
    expect(store.getSecret(1)).toBeNull();
  });

  test("a token is locked after 5 bad tries", () => {
    const store = createEmbedStore();
    const minted = store.mintToken(identity());
    expect("bearer" in store.claim(minted.token)).toBe(true);
    for (let i = 0; i < 5; i += 1) expect(store.claim(minted.token)).toEqual({ error: "token_used" });
    expect(store.claim(minted.token)).toEqual({ error: "token_expired" });
  });

  test("sweep drops expired tokens and sessions", () => {
    const c = clock();
    const store = createEmbedStore({ now: c.now });
    store.mintToken(identity());
    const claimed = store.claim(store.mintToken(identity({ ttlSeconds: 30 })).token);
    if ("error" in claimed) throw new Error(claimed.error);
    expect(store.sweep()).toBe(0);
    c.tick(60_000);
    expect(store.sweep()).toBe(3);
    expect(store.sweep()).toBe(0);
  });
});
