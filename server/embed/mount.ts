// Wires the embed modules into the sidecar: claim routes, session auth and policy, driver-error handling, and the admin API.
import type { Express, Request, Response } from "express";
import type { ServerConfig } from "../web/config";
import { ACTIONS } from "../api-actions";
import { getManagedConnection, managedConnectionRepo, managedPlaceholder } from "../../lib/db/managed-connections";
import { createAdminApp, startAdminApp } from "./admin-routes";
import { assertEmbedEngine, EmbedEngineError } from "./connection-builder";
import { claimRouter, embedAuth, embedPolicy, onAuthError } from "./middleware";
import { asRecord } from "./policy";
import { createEmbedStore, startSweeper, type EmbedStore } from "./sessions";

export type EmbedRuntime = { store: EmbedStore | null };
export type EmbedFailure = { status: 401 | 403; error: "embed_session_revoked" | "embed_engine_unsupported" };

// Only proxies on private or loopback addresses (the in-cluster ingress) may set the client IP the claim limiter keys on.
const TRUSTED_PROXIES = "loopback, linklocal, uniquelocal";

// Reads the URL scheme of a connection string, or an empty string when it has none.
export function schemeOf(connectionString: unknown): string {
  if (typeof connectionString !== "string") return "";
  const match = /^([a-z][a-z0-9+.-]*):\/\//i.exec(connectionString);
  return match ? match[1].toLowerCase() : "";
}

// Throws EmbedEngineError when an embed request's pinned connection string is not one of the embed engines.
export function assertEmbedRequest(req: Request): void {
  if (!req.embed) return;
  assertEmbedEngine(schemeOf(asRecord(req.body).connectionString));
}

// Returns the schema-cache options for a request; embed sessions key the cache by their placeholder, never by the real string.
export function cacheOptionsFor(req: Request, options: unknown): Record<string, unknown> | undefined {
  const base = options && typeof options === "object" ? (options as Record<string, unknown>) : undefined;
  if (!req.embed) return base;
  return { ...(base ?? {}), cacheKey: managedPlaceholder(req.embed.externalId) };
}

// Classifies a thrown route error as an embed failure (revoking the session on a driver auth error), or null.
export function classifyEmbedFailure(runtime: EmbedRuntime, req: Request, err: unknown): EmbedFailure | null {
  if (!req.embed) return null;
  if (err instanceof EmbedEngineError) return { status: 403, error: err.code };
  if (runtime.store && onAuthError(runtime.store, req, err)) return { status: 401, error: "embed_session_revoked" };
  return null;
}

// Answers a thrown route error with the embed envelope when it is one; reports whether it did.
export function respondEmbedFailure(runtime: EmbedRuntime, req: Request, res: Response, err: unknown): boolean {
  const failure = classifyEmbedFailure(runtime, req, err);
  if (!failure) return false;
  res.status(failure.status).json({ success: false, error: failure.error });
  return true;
}

// Creates the session store and mounts the claim routes ahead of the global JSON parser; inert outside embed mode.
export function mountEmbedClaim(app: Express, cfg: ServerConfig): EmbedRuntime {
  if (!cfg.embedMode) return { store: null };
  const store = createEmbedStore();
  startSweeper(store);
  app.set("trust proxy", TRUSTED_PROXIES);
  app.use(claimRouter(store, { consoleOrigin: cfg.consoleOrigin ?? "" }));
  return { store };
}

// Mounts session auth and the request policy after the JSON parser; the policy's async errors become JSON answers.
export function mountEmbedSession(app: Express, runtime: EmbedRuntime): void {
  const store = runtime.store;
  if (!store) return;
  const policy = embedPolicy(store, ACTIONS, { loadRow: getManagedConnection });
  app.use(embedAuth(store));
  app.use((req, res, next) => {
    Promise.resolve(policy(req, res, next)).catch((err: unknown) => {
      if (!respondEmbedFailure(runtime, req, res, err)) res.status(500).json({ success: false, error: "embed_policy_failure" });
    });
  });
}

// Starts the admin API when configured and resolves with its address; null when there is none to start.
export async function startEmbedAdmin(cfg: ServerConfig, runtime: EmbedRuntime): Promise<string | null> {
  if (!cfg.admin || !runtime.store) return null;
  const app = createAdminApp({
    key: cfg.admin.key,
    store: runtime.store,
    consoleOrigin: cfg.consoleOrigin ?? "",
    repo: managedConnectionRepo,
    defaultTheme: cfg.embedTheme,
  });
  await startAdminApp(app, { port: cfg.admin.port, bind: cfg.admin.bind });
  return `${cfg.admin.bind}:${cfg.admin.port}`;
}
