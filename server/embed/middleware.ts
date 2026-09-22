import express, { type Request, type RequestHandler, type Response, type Router } from "express";
import type { ThemeSelection } from "../../lib/studio/themes/theme-catalog";
import type { EmbedSession, EmbedStore } from "./sessions";
import { buildConnectionString, redactForClient, type ManagedRowLike } from "./connection-builder";
import { asRecord, classifyStatement, decideEmbedRequest, isAuthError, type EmbedActionTable } from "./policy";
import { createRateLimiter } from "./rate-limit";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace -- Express request augmentation needs the namespace.
  namespace Express {
    interface Request {
      embed?: EmbedSession;
    }
  }
}

export type EmbedPolicyDeps = { loadRow: (connectionId: number) => Promise<ManagedRowLike | null> };
export type ClaimRouterConfig = { consoleOrigin: string; rateLimitPerMinute?: number; now?: () => number };
export type EmbedSessionPayload = {
  session?: string;
  connectionId: number;
  externalId: string;
  displayName: string;
  expiresAt: number;
  engine: string;
  label: string;
  consoleOrigin: string;
  theme: ThemeSelection | null;
};

type AuditLine = {
  ts: string;
  session: string;
  dbId: string;
  userId: string;
  engine: string;
  route: string;
  statementClass?: string;
  ms: number;
  ok: boolean;
};

const BEARER_PREFIX = "Bearer ";
const EMBED_BEARER_PREFIX = "emb_";
const BOOTSTRAP_PATH = /^\/studio\/[^/]+\/bootstrap$/;
const CONNECTION_PATH = /^\/api\/connections\/[^/]+$/;
const STATEMENT_PATHS = new Set(["/api/sql/run", "/api/explain-plan"]);

export type HeaderCarrier = { headers: { authorization?: string | undefined } };

// Reads the embed bearer from the Authorization header, or null when the request carries none.
export function readEmbedBearer(req: HeaderCarrier): string | null {
  const header = req.headers.authorization;
  if (typeof header !== "string" || !header.startsWith(BEARER_PREFIX)) return null;
  const value = header.slice(BEARER_PREFIX.length).trim();
  return value.startsWith(EMBED_BEARER_PREFIX) ? value : null;
}

// Sends the standard embed failure envelope.
function fail(res: Response, status: number, error: string): void {
  res.status(status).json({ success: false, error });
}

// Reports whether a value looks like a connections row.
function isRow(value: unknown): value is { id: number } {
  return typeof value === "object" && value !== null && typeof (value as { id?: unknown }).id === "number";
}

// Redacts a connections row echoed by the bootstrap or connection routes; other payloads pass through.
export function redactRowEchoes(path: string, body: unknown): unknown {
  const payload = asRecord(body);
  const data = asRecord(payload.data);
  if (BOOTSTRAP_PATH.test(path) && isRow(data.connection)) {
    return { ...payload, data: { ...data, connection: redactForClient(data.connection) } };
  }
  if (CONNECTION_PATH.test(path) && isRow(payload.data)) {
    return { ...payload, data: redactForClient(payload.data) };
  }
  return body;
}

// Writes one JSON audit line to stderr; never includes SQL, params or connection strings.
function writeAudit(line: AuditLine): void {
  process.stderr.write(`${JSON.stringify(line)}\n`);
}

// Shapes the session fields an embed client may see, with the bearer only right after a claim.
function sessionPayload(session: EmbedSession, bearer: string | null, consoleOrigin: string): EmbedSessionPayload {
  const { connectionId, externalId, displayName, expiresAt, engine, label } = session;
  const base = { connectionId, externalId, displayName, expiresAt, engine, label, consoleOrigin, theme: session.theme ?? null };
  return bearer === null ? base : { session: bearer, ...base };
}

// Attaches the embed session to requests carrying an embed bearer; other requests pass through untouched.
export function embedAuth(store: EmbedStore): RequestHandler {
  return (req, res, next) => {
    const bearer = readEmbedBearer(req);
    if (bearer === null) return next();
    const found = store.lookup(bearer);
    if (!found.ok) return fail(res, 401, found.error);
    req.embed = found.session;
    next();
  };
}

// Wraps res.json to redact row echoes, turn driver auth failures into a revocation, and audit the call.
function installResponseHooks(store: EmbedStore, req: Request, res: Response, session: EmbedSession, startedAt: number): void {
  const original = res.json.bind(res);
  const statementClass = STATEMENT_PATHS.has(req.path) ? classifyStatement(asRecord(req.body).query) : null;
  let ok = true;
  res.json = ((body?: unknown) => {
    const payload = asRecord(body);
    if (payload.success === false && isAuthError(payload.error, session.engine)) {
      store.revokeByExternalId(session.externalId);
      ok = false;
      res.status(401);
      return original({ success: false, error: "embed_session_revoked" });
    }
    ok = payload.success !== false;
    return original(redactRowEchoes(req.path, body));
  }) as typeof res.json;
  res.on("finish", () => {
    writeAudit({
      ts: new Date().toISOString(),
      session: session.id.slice(0, 8),
      dbId: session.dbId,
      userId: session.userId,
      engine: session.engine,
      route: `${req.method} ${req.path}`,
      ...(statementClass ? { statementClass } : {}),
      ms: Date.now() - startedAt,
      ok: ok && res.statusCode < 400,
    });
  });
}

// Enforces the embed allow-list on session requests, pins the connection string, and installs the response hooks.
export function embedPolicy(store: EmbedStore, actions: EmbedActionTable, deps: EmbedPolicyDeps): RequestHandler {
  return async (req, res, next) => {
    const session = req.embed;
    if (!session) return next();
    const startedAt = Date.now();
    const secret = store.getSecret(session.connectionId);
    const row = secret ? await deps.loadRow(session.connectionId) : null;
    const connectionString = secret && row ? buildConnectionString(row, secret.password, secret.options) : "";
    const decision = decideEmbedRequest({ method: req.method, path: req.path, body: req.body, session, actions, connectionString });
    if (!decision.allow) return fail(res, decision.status, decision.error);
    if (decision.rewriteBody && connectionString === "") {
      store.revokeSession(session.id);
      return fail(res, 401, "embed_session_revoked");
    }
    if (decision.rewriteBody) req.body = decision.rewriteBody;
    installResponseHooks(store, req, res, session, startedAt);
    next();
  };
}

// Revokes every session on the request's connection when a thrown driver error is an auth failure; reports whether it did.
export function onAuthError(store: EmbedStore, req: Request, err: unknown): boolean {
  const session = req.embed;
  if (!session || !isAuthError(err, session.engine)) return false;
  store.revokeByExternalId(session.externalId);
  return true;
}

// Answers JSON body-parser failures on the claim routes with a typed 400 instead of Express's HTML page.
function claimErrorHandler(err: unknown, _req: Request, res: Response, next: express.NextFunction): void {
  if (res.headersSent) return next(err);
  const status = typeof (err as { status?: unknown }).status === "number" ? (err as { status: number }).status : 400;
  fail(res, status, status === 413 ? "payload_too_large" : "invalid_json");
}

// Builds the public claim router: token → bearer exchange and the session echo, JSON only, IP rate limited.
export function claimRouter(store: EmbedStore, cfg: ClaimRouterConfig): Router {
  const router = express.Router();
  const limiter = createRateLimiter(cfg.rateLimitPerMinute ?? 20, 60_000, cfg.now);
  router.post("/api/embed/claim", express.json({ limit: "4kb" }), (req, res) => {
    if (!limiter.allow(req.ip ?? "unknown")) return fail(res, 429, "rate_limited");
    if (!req.is("application/json")) return fail(res, 415, "json_required");
    const token = asRecord(req.body).token;
    if (typeof token !== "string" || token === "") return fail(res, 400, "token_required");
    const result = store.claim(token);
    if ("error" in result) return fail(res, 410, result.error);
    res.status(200).json({ success: true, data: sessionPayload(result.session, result.bearer, cfg.consoleOrigin) });
  });
  router.get("/api/embed/session", (req, res) => {
    const bearer = readEmbedBearer(req);
    if (bearer === null) return fail(res, 401, "embed_session_expired");
    const found = store.lookup(bearer);
    if (!found.ok) return fail(res, 401, found.error);
    res.json({ success: true, data: sessionPayload(found.session, null, cfg.consoleOrigin) });
  });
  router.use(claimErrorHandler);
  return router;
}
