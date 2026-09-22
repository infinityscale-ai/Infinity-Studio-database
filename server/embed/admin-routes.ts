import express, { type Express, type NextFunction, type Request, type RequestHandler, type Response } from "express";
import { createHash, timingSafeEqual } from "node:crypto";
import type { Server } from "node:http";
import type { ManagedConnectionFilter, ManagedConnectionRepo } from "../../lib/db/managed-connections";
import type { ThemeSelection } from "../../lib/studio/themes/theme-catalog";
import type { EmbedStore } from "./sessions";
import { engineToConnectionType } from "./connection-builder";
import { EXTERNAL_ID_PATTERN, parseAdminSessionRequest, type AdminSessionRequest } from "./admin-validation";

export type { AdminSessionRequest };
export type AdminAppDeps = {
  key: string;
  store: EmbedStore;
  consoleOrigin: string;
  repo: ManagedConnectionRepo;
  defaultTheme: ThemeSelection | null;
};
export type AdminListen = { port: number; bind: string };

export class EmbedConfigError extends Error {
  readonly code = "embed_config_invalid";
}

const MIN_KEY_LENGTH = 32;
const BEARER_PREFIX = "Bearer ";

// Compares the presented bearer with the configured admin key in constant time over SHA-256 digests.
function keyMatches(presented: string, key: string): boolean {
  const a = createHash("sha256").update(presented).digest();
  const b = createHash("sha256").update(key).digest();
  return timingSafeEqual(a, b);
}

// Rejects requests whose Authorization header does not carry the admin key; the key itself is never logged.
function adminAuth(key: string): RequestHandler {
  return (req, res, next) => {
    const header = req.headers.authorization;
    const presented = typeof header === "string" && header.startsWith(BEARER_PREFIX) ? header.slice(BEARER_PREFIX.length).trim() : "";
    if (!keyMatches(presented, key)) return res.status(401).json({ error: "unauthorized" });
    next();
  };
}

// Writes a structured failure line to stderr without any request body or credential.
function logAdminFailure(op: string, err: unknown): void {
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(`${JSON.stringify({ ts: new Date().toISOString(), scope: "embed-admin", op, error: message })}\n`);
}

// Reads the `purge=1|true` query flag.
function wantsPurge(query: Request["query"]): boolean {
  return query.purge === "1" || query.purge === "true";
}

// Reads the revocation target from `?db=` or `?user=`, or null when neither is a non-empty string.
function readRevokeTarget(query: Request["query"]): ManagedConnectionFilter | null {
  if (typeof query.db === "string" && query.db !== "") return { dbId: query.db };
  if (typeof query.user === "string" && query.user !== "") return { userId: query.user };
  return null;
}

// Revokes the store sessions matching a filter and returns the count.
function revokeByFilter(store: EmbedStore, filter: ManagedConnectionFilter): number {
  if ("dbId" in filter) return store.revokeByDb(filter.dbId);
  if ("userId" in filter) return store.revokeByUser(filter.userId);
  return store.revokeByExternalId(filter.externalId);
}

// Revokes sessions for a filter, optionally purging the matching rows, and answers 404 when nothing matched.
async function revokeAndRespond(deps: AdminAppDeps, res: Response, filter: ManagedConnectionFilter, purge: boolean): Promise<void> {
  try {
    const revoked = revokeByFilter(deps.store, filter);
    const rows = await deps.repo.find(filter);
    if (revoked === 0 && rows.length === 0) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    let purged = 0;
    for (const row of purge ? rows : []) {
      if (await deps.repo.purge(row.id)) purged += 1;
      deps.store.deleteSecret(row.id);
    }
    res.json({ revoked, purged });
  } catch (err) {
    logAdminFailure("revoke", err);
    res.status(500).json({ error: "store_failure" });
  }
}

// Upserts the managed row, parks the password in memory, and mints a single-use claim token.
function createSessionHandler(deps: AdminAppDeps): RequestHandler {
  return async (req, res) => {
    const parsed = parseAdminSessionRequest(req.body, deps.defaultTheme);
    if (!parsed.ok) return res.status(400).json({ error: parsed.code, ...(parsed.field ? { field: parsed.field } : {}) });
    const v = parsed.value;
    try {
      const connectionId = await deps.repo.upsert({
        externalId: v.externalId,
        label: v.label,
        connectionType: engineToConnectionType(v.engine),
        host: v.host,
        port: v.port,
        database: v.database,
        username: v.username,
      });
      deps.store.setSecret(connectionId, { password: v.password, options: v.options });
      const minted = deps.store.mintToken({
        connectionId,
        externalId: v.externalId,
        userId: v.userId,
        dbId: v.dbId,
        displayName: v.displayName,
        engine: v.engine,
        label: v.label,
        theme: v.theme,
        ttlSeconds: v.ttlSeconds,
        tokenTtlSeconds: v.tokenTtlSeconds,
      });
      res.status(201).json({ connectionId, token: minted.token, tokenExpiresAt: new Date(minted.expiresAt).toISOString() });
    } catch (err) {
      logAdminFailure("create", err);
      res.status(500).json({ error: "store_failure" });
    }
  };
}

// Handles `DELETE /admin/v1/embed-sessions?db=|?user=[&purge=1]`.
function revokeByQueryHandler(deps: AdminAppDeps): RequestHandler {
  return async (req, res) => {
    const target = readRevokeTarget(req.query);
    if (!target) return res.status(400).json({ error: "target_required" });
    await revokeAndRespond(deps, res, target, wantsPurge(req.query));
  };
}

// Handles `DELETE /admin/v1/embed-sessions/:externalId[?purge=1]` with a path-escaped external id.
function revokeByExternalIdHandler(deps: AdminAppDeps): RequestHandler {
  return async (req, res) => {
    const externalId = req.params.externalId;
    if (typeof externalId !== "string" || !EXTERNAL_ID_PATTERN.test(externalId)) {
      return res.status(400).json({ error: "invalid_external_id" });
    }
    await revokeAndRespond(deps, res, { externalId }, wantsPurge(req.query));
  };
}

// Answers body-parser failures with a typed JSON error instead of Express's HTML page.
function jsonErrorHandler(err: unknown, _req: Request, res: Response, next: NextFunction): void {
  if (res.headersSent) return next(err);
  const status = typeof (err as { status?: unknown }).status === "number" ? (err as { status: number }).status : 400;
  res.status(status).json({ error: status === 413 ? "payload_too_large" : "invalid_json" });
}

// Builds the admin API app: public health, then session minting and revocation behind the admin key.
export function createAdminApp(deps: AdminAppDeps): Express {
  if (typeof deps.key !== "string" || deps.key.length < MIN_KEY_LENGTH) {
    throw new EmbedConfigError(`INFSTUDIO_ADMIN_KEY must be at least ${MIN_KEY_LENGTH} characters`);
  }
  const app = express();
  app.disable("x-powered-by");
  app.get("/admin/v1/health", (_req, res) => {
    res.json({ ok: true });
  });
  app.use(adminAuth(deps.key));
  app.use(express.json({ limit: "64kb" }));
  app.post("/admin/v1/embed-sessions", createSessionHandler(deps));
  app.delete("/admin/v1/embed-sessions", revokeByQueryHandler(deps));
  app.delete("/admin/v1/embed-sessions/:externalId", revokeByExternalIdHandler(deps));
  app.use(jsonErrorHandler);
  return app;
}

// Starts the admin app on the given bind address and resolves with the listening server.
export function startAdminApp(app: Express, listen: AdminListen): Promise<Server> {
  return new Promise((resolve, reject) => {
    const server = app.listen(listen.port, listen.bind, () => resolve(server));
    server.once("error", reject);
  });
}
