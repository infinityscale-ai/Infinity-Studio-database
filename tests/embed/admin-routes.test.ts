import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { Connection } from "../../lib/db/schema";
import type { ManagedConnectionFilter, ManagedConnectionInput, ManagedConnectionRepo } from "../../lib/db/managed-connections";
import { createEmbedStore, type EmbedStore } from "../../server/embed/sessions";
import { createAdminApp, EmbedConfigError, startAdminApp } from "../../server/embed/admin-routes";

const KEY = "0123456789abcdef0123456789abcdef";

// Builds a full connections row from a managed input.
function makeRow(id: number, input: ManagedConnectionInput): Connection {
  return {
    id,
    name: input.label,
    connectionString: `embed://${input.externalId}`,
    connectionType: input.connectionType,
    host: input.host,
    port: String(input.port),
    database: input.database,
    username: input.username,
    password: null,
    sslMode: null,
    authToken: null,
    createdAt: new Date(),
    sortOrder: id,
    environment: null,
    color: null,
    group: null,
    isFavorite: false,
    lastActive: null,
    externalId: input.externalId,
    managed: 1,
  };
}

// Matches a row against a repo filter the way the SQL LIKE patterns do.
function matches(row: Connection, filter: ManagedConnectionFilter): boolean {
  const ext = row.externalId ?? "";
  if ("dbId" in filter) return ext.endsWith(`/${filter.dbId}`);
  if ("userId" in filter) return ext.startsWith(`${filter.userId}/`);
  return ext === filter.externalId;
}

// Creates an in-memory ManagedConnectionRepo that records every upsert input.
function createFakeRepo() {
  const rows = new Map<number, Connection>();
  const inputs: ManagedConnectionInput[] = [];
  let nextId = 100;
  const repo: ManagedConnectionRepo = {
    async findByExternalId(externalId) {
      return [...rows.values()].find((r) => r.externalId === externalId) ?? null;
    },
    async findById(id) {
      return rows.get(id) ?? null;
    },
    async find(filter) {
      return [...rows.values()].filter((r) => matches(r, filter));
    },
    async upsert(input) {
      inputs.push(input);
      const existing = [...rows.values()].find((r) => r.externalId === input.externalId);
      const id = existing?.id ?? nextId++;
      rows.set(id, makeRow(id, input));
      return id;
    },
    async purge(id) {
      return rows.delete(id);
    },
  };
  return { repo, rows, inputs };
}

// Builds a valid session request body with overrides.
function sessionBody(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    externalId: "u1/d1",
    userId: "u1",
    dbId: "d1",
    label: "orders",
    engine: "postgres",
    host: "db.internal",
    port: 5432,
    username: "app",
    password: "p@ss",
    database: "orders",
    ...over,
  };
}

let server: Server;
let base = "";
let store: EmbedStore;
let fake: ReturnType<typeof createFakeRepo>;

// Sends a request to the admin app; a string body is sent verbatim, anything else as JSON.
async function call(method: string, path: string, body?: unknown, key: string | null = KEY) {
  const headers: Record<string, string> = {};
  if (key !== null) headers.authorization = `Bearer ${key}`;
  if (body !== undefined) headers["content-type"] = "application/json";
  const res = await fetch(base + path, { method, headers, body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body) });
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

beforeAll(async () => {
  store = createEmbedStore();
  fake = createFakeRepo();
  const app = createAdminApp({ key: KEY, store, consoleOrigin: "https://console.example", repo: fake.repo });
  server = await startAdminApp(app, { port: 0, bind: "127.0.0.1" });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => {
  server.close();
});

describe("admin app", () => {
  test("refuses a short admin key at construction", () => {
    expect(() => createAdminApp({ key: "short", store, consoleOrigin: "x", repo: fake.repo })).toThrow(EmbedConfigError);
  });

  test("health is public", async () => {
    expect(await call("GET", "/admin/v1/health", undefined, null)).toEqual({ status: 200, json: { ok: true } });
  });

  test("a missing or wrong key is unauthorized", async () => {
    expect((await call("POST", "/admin/v1/embed-sessions", sessionBody(), null)).status).toBe(401);
    expect((await call("POST", "/admin/v1/embed-sessions", sessionBody(), "x".repeat(32))).status).toBe(401);
    expect((await call("DELETE", "/admin/v1/embed-sessions?db=d1", undefined, `${KEY}0`)).status).toBe(401);
  });

  test("a valid request upserts the row without the password and returns a claim token", async () => {
    const before = Date.now();
    const created = await call("POST", "/admin/v1/embed-sessions", sessionBody());
    expect(created.status).toBe(201);
    expect(String(created.json.token).startsWith("tok_")).toBe(true);
    expect(Date.parse(String(created.json.tokenExpiresAt))).toBeGreaterThanOrEqual(before + 60_000);
    const connectionId = created.json.connectionId as number;
    expect(fake.inputs.at(-1)).toEqual({ externalId: "u1/d1", label: "orders", connectionType: "postgres", host: "db.internal", port: 5432, database: "orders", username: "app" });
    expect(JSON.stringify(fake.rows.get(connectionId))).not.toContain("p@ss");
    expect(store.getSecret(connectionId)).toEqual({ password: "p@ss", options: {} });
    const again = await call("POST", "/admin/v1/embed-sessions", sessionBody({ engine: "mongo", options: { authSource: "orders" }, displayName: "Orders DB" }));
    expect(again.status).toBe(201);
    expect(again.json.connectionId).toBe(connectionId);
    expect(fake.rows.get(connectionId)?.connectionType).toBe("mongodb");
    expect(store.getSecret(connectionId)?.options).toEqual({ authSource: "orders" });
  });

  test.each([
    ["readOnly", sessionBody({ readOnly: true }), "read_only_unsupported"],
    ["engine", sessionBody({ engine: "sqlite" }), "invalid_engine"],
    ["externalId mismatch", sessionBody({ externalId: "u9/d1" }), "invalid_external_id"],
    ["externalId shape", sessionBody({ externalId: "u1", userId: "u1", dbId: "" }), "invalid_external_id"],
    ["port", sessionBody({ port: 0 }), "invalid_port"],
    ["host", sessionBody({ host: " " }), "invalid_host"],
    ["ttl", sessionBody({ ttlSeconds: 90_000 }), "invalid_ttl"],
    ["token ttl", sessionBody({ tokenTtlSeconds: 301 }), "invalid_ttl"],
    ["missing label", sessionBody({ label: undefined }), "missing_field"],
    ["long field", sessionBody({ label: "x".repeat(513) }), "field_too_long"],
    ["options", sessionBody({ options: { sslmode: "yes" } }), "invalid_field"],
    ["array body", [], "invalid_body"],
  ])("rejects %s with 400", async (_name, body, code) => {
    const res = await call("POST", "/admin/v1/embed-sessions", body);
    expect(res.status).toBe(400);
    expect(res.json.error).toBe(code);
  });

  test("malformed JSON is a typed 400", async () => {
    expect(await call("POST", "/admin/v1/embed-sessions", "{nope")).toEqual({ status: 400, json: { error: "invalid_json" } });
  });

  test("DELETE ?db= revokes live sessions and unclaimed tokens", async () => {
    const a = await call("POST", "/admin/v1/embed-sessions", sessionBody({ externalId: "u1/d3", dbId: "d3" }));
    const b = await call("POST", "/admin/v1/embed-sessions", sessionBody({ externalId: "u2/d3", userId: "u2", dbId: "d3" }));
    const other = await call("POST", "/admin/v1/embed-sessions", sessionBody({ externalId: "u1/d2", dbId: "d2" }));
    const claimed = store.claim(String(a.json.token));
    if ("error" in claimed) throw new Error(claimed.error);
    expect(await call("DELETE", "/admin/v1/embed-sessions?db=d3")).toEqual({ status: 200, json: { revoked: 2, purged: 0 } });
    expect(store.lookup(claimed.bearer)).toEqual({ ok: false, error: "embed_session_revoked" });
    expect(store.claim(String(b.json.token))).toEqual({ error: "token_expired" });
    expect("bearer" in store.claim(String(other.json.token))).toBe(true);
    expect(fake.rows.get(a.json.connectionId as number)).toBeDefined();
    expect(await call("DELETE", "/admin/v1/embed-sessions?db=d3")).toEqual({ status: 200, json: { revoked: 0, purged: 0 } });
  });

  test("DELETE ?user= and /:externalId with purge remove rows and secrets", async () => {
    const created = await call("POST", "/admin/v1/embed-sessions", sessionBody({ externalId: "u5/d5", userId: "u5", dbId: "d5" }));
    const id = created.json.connectionId as number;
    expect(await call("DELETE", "/admin/v1/embed-sessions?user=u5")).toEqual({ status: 200, json: { revoked: 1, purged: 0 } });
    expect(await call("DELETE", "/admin/v1/embed-sessions/u5%2Fd5?purge=1")).toEqual({ status: 200, json: { revoked: 0, purged: 1 } });
    expect(fake.rows.has(id)).toBe(false);
    expect(store.getSecret(id)).toBeNull();
  });

  test("unknown targets are 404 and a missing target is 400", async () => {
    expect((await call("DELETE", "/admin/v1/embed-sessions?db=nope")).status).toBe(404);
    expect((await call("DELETE", "/admin/v1/embed-sessions/u9%2Fd9")).status).toBe(404);
    expect(await call("DELETE", "/admin/v1/embed-sessions")).toEqual({ status: 400, json: { error: "target_required" } });
    expect(await call("DELETE", "/admin/v1/embed-sessions/bad%20id")).toEqual({ status: 400, json: { error: "invalid_external_id" } });
  });
});
