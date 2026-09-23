import { describe, expect, test } from "bun:test";
import type { Express, Request, Response } from "express";
import { EmbedEngineError } from "../../server/embed/connection-builder";
import {
  assertEmbedRequest,
  cacheOptionsFor,
  classifyEmbedFailure,
  mountEmbedClaim,
  mountEmbedSession,
  respondEmbedFailure,
  schemeOf,
} from "../../server/embed/mount";
import { createEmbedStore, type EmbedSession } from "../../server/embed/sessions";
import type { ServerConfig } from "../../server/web/config";

const SESSION: EmbedSession = {
  id: "abc", connectionId: 7, externalId: "u1/d1", userId: "u1", dbId: "d1", displayName: "orders",
  engine: "postgres", label: "orders", createdAt: 0, expiresAt: Number.MAX_SAFE_INTEGER, revoked: false,
};

// Builds a minimal request carrying an optional embed session and JSON body.
function req(body: unknown, embed?: EmbedSession): Request {
  return { body, embed } as unknown as Request;
}

// Builds a config with embed mode on or off and no admin listener.
function cfg(embedMode: boolean): ServerConfig {
  return {
    port: 3867, bind: "127.0.0.1", strictPort: true, staticDir: null, dataDir: "/tmp", apiKey: "",
    allowUnauthenticated: false, corsOrigins: [], embedMode, embedAllowedOrigins: [], consoleOrigin: null,
    embedTheme: null, admin: null, mcpDisabled: true,
    localTools: false,
  };
}

// Records what a mount registered on the app without running Express.
function fakeApp(): Express & { settings: Record<string, unknown>; handlers: unknown[] } {
  const settings: Record<string, unknown> = {};
  const handlers: unknown[] = [];
  return {
    settings,
    handlers,
    set: (key: string, value: unknown) => { settings[key] = value; },
    use: (handler: unknown) => { handlers.push(handler); },
  } as unknown as Express & { settings: Record<string, unknown>; handlers: unknown[] };
}

describe("schemeOf", () => {
  test("reads the URL scheme and nothing else", () => {
    expect(schemeOf("postgres://app:pw@host:5432/db")).toBe("postgres");
    expect(schemeOf("MongoDB://host/db")).toBe("mongodb");
    expect(schemeOf("embed://7")).toBe("embed");
    expect(schemeOf("not a url")).toBe("");
    expect(schemeOf(42)).toBe("");
  });
});

describe("assertEmbedRequest", () => {
  test("ignores requests without a session", () => {
    expect(() => assertEmbedRequest(req({ connectionString: "sqlite://x" }))).not.toThrow();
  });

  test("accepts the four embed engines and rejects everything else", () => {
    for (const scheme of ["postgres", "mysql", "mongodb", "redis"]) {
      expect(() => assertEmbedRequest(req({ connectionString: `${scheme}://h/d` }, SESSION))).not.toThrow();
    }
    expect(() => assertEmbedRequest(req({ connectionString: "sqlite://x" }, SESSION))).toThrow(EmbedEngineError);
    expect(() => assertEmbedRequest(req({}, SESSION))).toThrow(EmbedEngineError);
  });
});

describe("cacheOptionsFor", () => {
  test("leaves standalone options untouched", () => {
    expect(cacheOptionsFor(req({}), { forceRefresh: true })).toEqual({ forceRefresh: true });
    expect(cacheOptionsFor(req({}), undefined)).toBeUndefined();
  });

  test("keys the schema cache by the managed placeholder for embed sessions", () => {
    expect(cacheOptionsFor(req({}, SESSION), { forceRefresh: true })).toEqual({ forceRefresh: true, cacheKey: "embed://u1/d1" });
    expect(cacheOptionsFor(req({}, SESSION), undefined)).toEqual({ cacheKey: "embed://u1/d1" });
  });
});

describe("classifyEmbedFailure", () => {
  test("is null outside a session or for an ordinary error", () => {
    const store = createEmbedStore();
    expect(classifyEmbedFailure({ store }, req({}), new Error("boom"))).toBeNull();
    expect(classifyEmbedFailure({ store }, req({}, SESSION), new Error("syntax error"))).toBeNull();
  });

  test("maps an unsupported engine to 403 and a driver auth failure to a revoking 401", () => {
    const store = createEmbedStore();
    store.setSecret(7, { password: "x", options: {} });
    const minted = store.mintToken({ ...SESSION, ttlSeconds: 60 });
    const claimed = store.claim(minted.token);
    if ("error" in claimed) throw new Error("claim failed");
    const live = claimed.session;
    expect(classifyEmbedFailure({ store }, req({}, live), new EmbedEngineError("no"))).toEqual({ status: 403, error: "embed_engine_unsupported" });
    const authErr = Object.assign(new Error("password authentication failed"), { code: "28P01" });
    expect(classifyEmbedFailure({ store }, req({}, live), authErr)).toEqual({ status: 401, error: "embed_session_revoked" });
    expect(store.lookup(claimed.bearer)).toEqual({ ok: false, error: "embed_session_revoked" });
  });

  test("respondEmbedFailure writes the envelope only when it applies", () => {
    const sent: unknown[] = [];
    const res = { status: (code: number) => ({ json: (body: unknown) => sent.push([code, body]) }) } as unknown as Response;
    expect(respondEmbedFailure({ store: null }, req({}, SESSION), res, new EmbedEngineError("no"))).toBe(true);
    expect(sent).toEqual([[403, { success: false, error: "embed_engine_unsupported" }]]);
    expect(respondEmbedFailure({ store: null }, req({}), res, new Error("x"))).toBe(false);
    expect(sent).toHaveLength(1);
  });
});

describe("mountEmbedClaim / mountEmbedSession", () => {
  test("are inert outside embed mode", () => {
    const app = fakeApp();
    const runtime = mountEmbedClaim(app, cfg(false));
    mountEmbedSession(app, runtime);
    expect(runtime.store).toBeNull();
    expect(app.handlers).toHaveLength(0);
    expect(app.settings).toEqual({});
  });

  test("register the claim router, then auth and policy, and trust only private proxies", () => {
    const app = fakeApp();
    const runtime = mountEmbedClaim(app, cfg(true));
    expect(runtime.store).not.toBeNull();
    expect(app.handlers).toHaveLength(1);
    expect(app.settings["trust proxy"]).toBe("loopback, linklocal, uniquelocal");
    mountEmbedSession(app, runtime);
    expect(app.handlers).toHaveLength(3);
  });
});
