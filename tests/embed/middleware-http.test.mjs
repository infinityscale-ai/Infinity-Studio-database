import { afterAll, beforeAll, describe, expect, test } from "bun:test";
// The embed routers are built on the server's own Express copy, so the host app must use the same one.
import express from "../../server/node_modules/express/index.js";
import { createEmbedStore } from "../../server/embed/sessions.ts";
import { claimRouter, embedAuth, embedPolicy } from "../../server/embed/middleware.ts";

const ROW = { id: 7, connectionType: "postgres", host: "db.internal", port: "5432", database: "orders", username: "app" };
const RESOLVED = "postgres://app:s3cret@db.internal:5432/orders?sslmode=disable";
const ACTIONS = {
  fetchSchemas: { csArg: 0, connIdArg: null, write: false, embed: "allow" },
  runDbBackup: { csArg: 0, connIdArg: null, write: true, embed: "deny" },
};

let store;
let server;
let base = "";
let lastBody = null;

// Mints a claim token for connection 7 with an optional theme and parks its secret.
function mint(theme = null) {
  store.setSecret(7, { password: "s3cret", options: {} });
  return store.mintToken({ connectionId: 7, externalId: "u1/d1", userId: "u1", dbId: "d1", displayName: "orders", engine: "postgres", label: "orders", theme, ttlSeconds: 3600 }).token;
}

// Sends a request with an optional embed bearer and JSON body.
async function call(method, path, bearer, body, contentType = "application/json") {
  const headers = {};
  if (bearer) headers.authorization = `Bearer ${bearer}`;
  if (body !== undefined) headers["content-type"] = contentType;
  const res = await fetch(base + path, { method, headers, body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body) });
  return { status: res.status, json: await res.json() };
}

// Claims a token over HTTP and returns the bearer.
async function claim(token) {
  const res = await call("POST", "/api/embed/claim", null, { token });
  return { ...res, bearer: res.json.data?.session };
}

beforeAll(async () => {
  store = createEmbedStore();
  const app = express();
  // The claim router parses its own body, so it sits before the global parser and owns its JSON errors.
  app.use(claimRouter(store, { consoleOrigin: "https://console.example", rateLimitPerMinute: 1000 }));
  app.use(express.json());
  app.use(embedAuth(store));
  app.use(embedPolicy(store, ACTIONS, { loadRow: async (id) => (id === 7 ? ROW : null) }));
  app.post("/api/sql/run", (req, res) => {
    lastBody = req.body;
    if (req.body.query === "SELECT 1") return res.json({ success: true, data: { rows: [] } });
    res.json({ success: false, error: 'password authentication failed for user "app"' });
  });
  app.get("/studio/:id/bootstrap", (_req, res) => {
    res.json({ success: true, data: { connection: { id: 7, name: "orders", connectionString: "embed://u1/d1", host: "db.internal", username: "app", port: "5432", password: null, authToken: null }, tabs: [] } });
  });
  app.get("/api/connections", (_req, res) => res.json({ success: true, data: [] }));
  app.post("/api/actions/:action", (req, res) => {
    lastBody = req.body;
    res.json({ success: true });
  });
  app.get("/api/app-font", (_req, res) => res.json({ success: true, data: "Inter" }));
  await new Promise((resolve) => {
    server = app.listen(0, "127.0.0.1", resolve);
  });
  base = `http://127.0.0.1:${server.address().port}`;
});

afterAll(() => server.close());

describe("embed middleware over HTTP", () => {
  test("claim exchanges a token once and only as JSON", async () => {
    const token = mint();
    const first = await claim(token);
    expect(first.status).toBe(200);
    expect(first.bearer.startsWith("emb_")).toBe(true);
    expect(first.json.data).toMatchObject({ connectionId: 7, externalId: "u1/d1", displayName: "orders", engine: "postgres", label: "orders", consoleOrigin: "https://console.example", theme: null });
    expect((await claim(token)).json).toEqual({ success: false, error: "token_used" });
    expect(await call("POST", "/api/embed/claim", null, { token: "tok_nope" })).toEqual({ status: 410, json: { success: false, error: "token_expired" } });
    expect((await call("POST", "/api/embed/claim", null, "token=x", "text/plain")).status).toBe(415);
    expect(await call("POST", "/api/embed/claim", null, {})).toEqual({ status: 400, json: { success: false, error: "token_required" } });
    expect(await call("POST", "/api/embed/claim", null, "{bad")).toEqual({ status: 400, json: { success: false, error: "invalid_json" } });
  });

  test("the claim and the session echo carry the console's theme choice", async () => {
    const theme = { app: "infinityscale", editor: "infinityscale-dark" };
    const claimed = await claim(mint(theme));
    expect(claimed.json.data.theme).toEqual(theme);
    expect((await call("GET", "/api/embed/session", claimed.bearer)).json.data.theme).toEqual(theme);
  });

  test("the session echo needs a live bearer and never returns it", async () => {
    const { bearer } = await claim(mint());
    const echo = await call("GET", "/api/embed/session", bearer);
    expect(echo.status).toBe(200);
    expect(echo.json.data.session).toBeUndefined();
    expect(echo.json.data.engine).toBe("postgres");
    expect(echo.json.data.theme).toBeNull();
    expect(await call("GET", "/api/embed/session")).toEqual({ status: 401, json: { success: false, error: "embed_session_expired" } });
    expect(await call("GET", "/api/embed/session", "emb_bogus")).toEqual({ status: 401, json: { success: false, error: "embed_session_expired" } });
  });

  test("requests without an embed bearer pass through; embed sessions hit the allow-list", async () => {
    const { bearer } = await claim(mint());
    expect((await call("GET", "/api/connections")).status).toBe(200);
    expect(await call("GET", "/api/connections", bearer)).toEqual({ status: 403, json: { success: false, error: "embed_forbidden" } });
    expect((await call("GET", "/api/app-font", bearer)).status).toBe(200);
  });

  test("sql/run receives the server-built connection string, never the client's", async () => {
    const { bearer } = await claim(mint());
    const res = await call("POST", "/api/sql/run", bearer, { connectionString: "postgres://evil@elsewhere/x", query: "SELECT 1" });
    expect(res).toEqual({ status: 200, json: { success: true, data: { rows: [] } } });
    expect(lastBody).toEqual({ connectionString: RESOLVED, query: "SELECT 1" });
  });

  test("bootstrap is redacted and other connection ids are forbidden", async () => {
    const { bearer } = await claim(mint());
    const own = await call("GET", "/studio/7/bootstrap", bearer);
    expect(own.status).toBe(200);
    expect(own.json.data.connection).toEqual({ id: 7, name: "orders", connectionString: "embed://7", host: null, username: null, port: null, password: null, authToken: null });
    expect((await call("GET", "/studio/8/bootstrap", bearer)).status).toBe(403);
  });

  test("actions are pinned by the table", async () => {
    const { bearer } = await claim(mint());
    expect((await call("POST", "/api/actions/fetchSchemas", bearer, { args: ["embed://7", "public"] })).status).toBe(200);
    expect(lastBody).toEqual({ args: [RESOLVED, "public"] });
    expect((await call("POST", "/api/actions/runDbBackup", bearer, { args: ["x"] })).status).toBe(403);
  });

  test("a driver auth failure revokes the connection's sessions", async () => {
    const { bearer } = await claim(mint());
    expect(await call("POST", "/api/sql/run", bearer, { query: "SELECT 2" })).toEqual({ status: 401, json: { success: false, error: "embed_session_revoked" } });
    expect(await call("GET", "/api/embed/session", bearer)).toEqual({ status: 401, json: { success: false, error: "embed_session_revoked" } });
    expect(store.getSecret(7)).toBeNull();
  });

  test("a session whose secret is gone is revoked on first use of the connection", async () => {
    const { bearer } = await claim(mint());
    store.deleteSecret(7);
    expect((await call("GET", "/api/app-font", bearer)).status).toBe(200);
    expect(await call("POST", "/api/sql/run", bearer, { query: "SELECT 1" })).toEqual({ status: 401, json: { success: false, error: "embed_session_revoked" } });
    expect(await call("GET", "/api/embed/session", bearer)).toEqual({ status: 401, json: { success: false, error: "embed_session_revoked" } });
  });
});
