import express from "express";
import cors from "cors";
import path from "path";
import fs from "fs";
import os from "os";
import crypto from "crypto";
import "pg";
import "redis";
import "drizzle-orm";
import "drizzle-orm/bun-sqlite";
import "nearley";
import { extractIndexColumns } from "../lib/db/pg-utils";
import { createInfinityStudioPiSession, streamPiResponse, type PiAgentInput, type PiSseEvent } from "../lib/ai/pi-agent";
import { getAgentSandboxCwd } from "../lib/agents/sandbox-cwd";
import { ensureEnrichedPath } from "../lib/system/shell-path";
import { isLoopback, readServerConfig, validateServerConfig } from "./web/config";
import { isStaticPageRequest, mountStatic } from "./web/static";
import { mountDiscoveryRoutes } from "./discovery/routes";
import { mountOciRoutes } from "./oci/routes";
import { lookupAction } from "./api-actions";
import { assertEmbedRequest, cacheOptionsFor, mountEmbedClaim, mountEmbedSession, respondEmbedFailure, startEmbedAdmin } from "./embed/mount";
import { clearSearchIndex, getSearchIndexStatus, saveSearchResultsToIndex, searchLocalIndex } from "../lib/db/search-index-actions";

// Packaged/prod desktop builds are launched by the OS, not a terminal, so
// process.env.PATH is missing Homebrew/nvm/npm-global dirs — enrich it
// before any CLI-detection (Neon, agent CLIs, etc.) runs below.
ensureEnrichedPath();

function log(...args: any[]) {
  let i = 0;
  const parts: string[] = [];
  while (i < args.length) {
    if (typeof args[i] === 'string' && args[i].includes('%s') && i + 1 < args.length) {
      parts.push(args[i].replace(/%s/g, () => {
        const val = args[++i];
        return typeof val === 'object' ? JSON.stringify(val) : String(val ?? '');
      }));
    } else {
      parts.push(typeof args[i] === 'object' ? JSON.stringify(args[i]) : String(args[i]));
    }
    i++;
  }
  process.stderr.write(parts.join(' ') + '\n');
}

const cfg = readServerConfig();
const PORT = cfg.port;

// Shared modules read the data dir from the env, so the resolved default is written back.
process.env.INFSTUDIO_USER_DATA_DIR = cfg.dataDir;

const configProblems = validateServerConfig(cfg);
if (configProblems.length > 0) {
  for (const problem of configProblems) process.stderr.write(`[infinity-studio-server] fatal: ${problem.message}\n`);
  process.exit(1);
}

// Log to a known-writable location so we can always find it; embed mode keeps no file log.
const LOG_FILE = cfg.embedMode ? null : path.join(os.tmpdir(), "infinity-studio-server.log");
function logToFile(...args: unknown[]) {
  if (!LOG_FILE) return;
  try {
    const line = `[${new Date().toISOString()}] ${args.map(a => String(a)).join(" ")}\n`;
    fs.appendFileSync(LOG_FILE, line);
  } catch {}
}
logToFile("=== server startup ===");
logToFile("cwd:", process.cwd());
logToFile("INFSTUDIO_USER_DATA_DIR:", process.env.INFSTUDIO_USER_DATA_DIR);
logToFile("HOME:", process.env.HOME);
logToFile("USERPROFILE:", process.env.USERPROFILE);
log("[infinity-studio:snapshot] Server startup — DB path:", process.env.INFSTUDIO_USER_DATA_DIR
  ? `${process.env.INFSTUDIO_USER_DATA_DIR}/sqlite.db`
  : `${process.cwd()}/sqlite.db`);


const app = express();

// Restrict CORS to localhost origins — this is a local sidecar, not a public API
const ALLOWED_ORIGINS = [
  'http://localhost:5173',
  'http://localhost:4173',
  'http://127.0.0.1:5173',
  'http://127.0.0.1:4173',
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'tauri://localhost',
  'http://tauri.localhost',
  ...cfg.corsOrigins,
  ...(cfg.consoleOrigin ? [cfg.consoleOrigin] : []),
];

// Reports whether an Origin header names this server itself: a browser sends one on every same-origin POST.
function isOwnOrigin(req: express.Request, origin: string): boolean {
  const host = req.headers.host;
  if (!host) return false;
  return origin === `${req.protocol}://${host}` || origin === `https://${host}`;
}

// CORS per request so the SPA served from INFSTUDIO_STATIC_DIR is allowed whatever host it is reached on.
function corsMiddleware(req: express.Request, res: express.Response, next: express.NextFunction) {
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (server-to-server, curl, Tauri)
      if (!origin) return callback(null, true);
      if (ALLOWED_ORIGINS.includes(origin) || isOwnOrigin(req, origin)) return callback(null, true);
      console.warn(`[cors] Blocked request from origin: ${origin}`);
      callback(new Error('Not allowed by CORS'));
    },
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'User-Agent', 'X-Supabase-Authorization'],
  })(req, res, next);
}

app.use(corsMiddleware);

// Multipart passthrough for Supabase function deploys (FormData with source
// files + metadata). Must run BEFORE express.json — the JSON parser cannot
// parse multipart bodies and would drop the files, causing upstream parse
// errors on deploy.
app.use(
  "/api/supabase-mgmt/proxy",
  express.raw({ type: "multipart/*", limit: "20mb" }),
);

// Embed mode: the claim router parses its own body, so it sits ahead of the global JSON parser.
const embed = mountEmbedClaim(app, cfg);

// Limit JSON body to 1MB (reduced from 50MB to prevent memory exhaustion)
app.use(express.json({ limit: "1mb" }));
// Strip trailing slashes so /api/agents and /api/agents/ both work
app.use((req, _res, next) => {
  if (req.path.length > 1 && req.path.endsWith('/')) {
    const qs = req.url.slice(req.path.length);
    req.url = req.path.slice(0, -1) + (qs || '');
  }
  next();
});

// Embed mode: bearer sessions are resolved and policed here; other requests pass through untouched.
mountEmbedSession(app, embed);

// Reports whether a request needs no API key: health, MCP (own bearer), the embed claim, and SPA pages/assets.
function isPublicRequest(req: express.Request): boolean {
  if (req.path === '/health' || req.path === '/mcp') return true;
  if (req.method === 'POST' && req.path === '/api/embed/claim') return true;
  return Boolean(cfg.staticDir) && isStaticPageRequest(req.method, req.path);
}

// Reports whether the Authorization header carries the configured API key (constant-time).
function bearerMatchesApiKey(authHeader: string | undefined): boolean {
  if (!authHeader || !authHeader.startsWith('Bearer ')) return false;
  const presented = Buffer.from(authHeader.slice(7));
  const expected = Buffer.from(cfg.apiKey);
  return presented.length === expected.length && crypto.timingSafeEqual(presented, expected);
}

// API key authentication; without a key, only loopback (never in embed mode) or INFSTUDIO_ALLOW_UNAUTHENTICATED lets requests through.
function authMiddleware(req: express.Request, res: express.Response, next: express.NextFunction) {
  if (req.embed || isPublicRequest(req)) return next();
  if (!cfg.apiKey) {
    if (cfg.allowUnauthenticated || (isLoopback(cfg.bind) && !cfg.embedMode)) return next();
    return res.status(401).json({ success: false, error: 'Unauthorized. This server accepts no unauthenticated requests.' });
  }
  if (!bearerMatchesApiKey(req.headers.authorization)) {
    return res.status(401).json({ success: false, error: 'Unauthorized. Provide Authorization: Bearer <token> header.' });
  }
  next();
}

app.use(authMiddleware);

// Health check
app.get("/health", (_req, res) => {
  res.json({ status: "ok", port: PORT });
});

// Authenticated no-op; the web client probes it to learn whether it needs an access key.
app.get("/api/auth/probe", (_req, res) => {
  res.json({ success: true });
});

// The machine scan and the local Oracle Cloud sign-in are served only where nobody else can reach the studio; the UI asks first.
app.get("/api/local-tools", (_req, res) => {
  res.json({ success: true, data: { enabled: cfg.localTools } });
});
if (cfg.localTools) {
  mountDiscoveryRoutes(app);
  mountOciRoutes(app);
}

// Supabase Management API proxy (avoids CORS in the browser)
app.all("/api/supabase-mgmt/proxy/*", async (req, res) => {
  try {
    const targetPath = (req.params as any)[0];
    const qs = Object.keys(req.query).length
      ? "?" + new URLSearchParams(req.query as Record<string, string>).toString()
      : "";
    const targetUrl = `https://api.supabase.com/${targetPath}${qs}`;
    const headers: Record<string, string> = {
      "User-Agent": "supabase-cli",
    };
    // The studio's own bearer rides in Authorization; the Supabase token comes in X-Supabase-Authorization.
    const upstreamAuth = req.headers["x-supabase-authorization"] ?? req.headers.authorization;
    if (typeof upstreamAuth === "string" && upstreamAuth) headers.Authorization = upstreamAuth;
    if (req.headers["user-agent"]) headers["User-Agent"] = req.headers["user-agent"];
    const fetchInit: RequestInit = {
      method: req.method,
      headers,
    };
    if (req.method !== "GET" && req.method !== "HEAD") {
      if (Buffer.isBuffer(req.body)) {
        // Multipart deploy payload (FormData) — forward bytes as-is with the
        // original boundary. JSON.stringify here would corrupt it.
        headers["Content-Type"] = req.headers["content-type"] || "application/octet-stream";
        fetchInit.body = req.body as any;
      } else {
        headers["Content-Type"] = req.headers["content-type"] || "application/json";
        if (req.body) {
          fetchInit.body = typeof req.body === "string" ? req.body : JSON.stringify(req.body);
        }
      }
    }
    const upstream = await fetch(targetUrl, fetchInit);
    const text = await upstream.text();
    res.status(upstream.status);
    try {
      res.json(JSON.parse(text));
    } catch {
      res.send(text);
    }
  } catch (e: any) {
    res.status(502).json({ success: false, error: e.message });
  }
});

// Load actions-core at module init — forces Bun to bundle it and all static deps
const actionsCore = require("../lib/db/actions-core");
const mod = actionsCore;

// --- API Routes ---

// Connections
app.get("/api/connections", async (req, res) => {
  try {
    const workspaceUrl = req.query.workspace as string | undefined;
    const result = await mod.getConnections(workspaceUrl || undefined);
    res.json({ success: true, data: result });
  } catch (e: any) {
    res.json({ success: false, error: e.message });
  }
});

// Connection groups (MUST be before /:id routes to avoid param capture)
app.get("/api/connections/groups", async (_req, res) => {
  try {
    const groups = await mod.listConnectionGroups();
    res.json({ success: true, groups });
  } catch (e: any) {
    res.json({ success: false, error: e.message, groups: [] });
  }
});

app.post("/api/connections/groups/add", simplePostRoute(body => mod.addConnectionGroup(body.folderName)));

app.post("/api/connections/groups/rename", simplePostRoute(body => mod.renameConnectionGroup(body.oldName, body.newName)));

app.post("/api/connections/groups/delete", simplePostRoute(body => mod.deleteConnectionGroup(body.folderName)));

app.get("/api/connections/:id", async (req, res) => {
  try {
    const result = await mod.getConnection(Number(req.params.id));
    res.json({ success: true, data: result || null });
  } catch (e: any) {
    res.json({ success: false, error: e.message });
  }
});

app.post("/api/connections", async (req, res) => {
  try {
    const { name, connectionString, connectionType, environment, color, groups, group, isFavorite, host, port, database, username, password, sslMode, authToken } = req.body;
    const resolvedGroups = Array.isArray(groups) ? groups : (group ? [group] : []);
    const result = await mod.addConnection(name, connectionString, connectionType, {
      environment, color, groups: resolvedGroups, group: resolvedGroups[0] || null, isFavorite,
      host, port, database, username, password, sslMode, authToken
    });
    res.json(result);
  } catch (e: any) {
    res.json({ success: false, error: e.message });
  }
});

app.put("/api/connections/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const result = await mod.updateConnection(id, req.body);
    res.json(result);
  } catch (e: any) {
    res.json({ success: false, error: e.message });
  }
});

app.delete("/api/connections/:id", async (req, res) => {
  try {
    const result = await mod.deleteConnection(Number(req.params.id));
    res.json(result);
  } catch (e: any) {
    res.json({ success: false, error: e.message });
  }
});

app.post("/api/connections/test", async (req, res) => {
  try {
    const { connectionString, connectionType } = req.body;
    logToFile("POST /api/connections/test connectionType:", connectionType);
    const result = await mod.testConnection(connectionString, connectionType);
    logToFile("POST /api/connections/test result success:", result.success, "error:", result.error);
    res.json(result);
  } catch (e: any) {
    logToFile("testConnection error:", e.message || e.code || String(e));
    res.json({ success: false, error: e.message });
  }
});

app.post("/api/connections/reorder", simplePostRoute(body => mod.reorderConnections(body.orderedIds)));

// ─── External MCP server (Settings → MCP Server) ────────────────────────────
// Config + allow-list management for the user-facing MCP server, plus the
// Streamable-HTTP endpoint itself. Secrets (connection strings, MCP bearer
// token) are never returned here except once on regenerate.
app.get("/api/mcp/config", async (_req, res) => {
  try {
    const { loadMcpExternalConfig, toMcpConfigSummary, listMcpModes } = await import("../lib/agents/mcp/external-config");
    const { listAllConnectionDeps, toPublicConnectionList } = await import("../lib/agents/mcp/registry");
    const config = await loadMcpExternalConfig();
    const all = await listAllConnectionDeps();
    // Verbatim stdio descriptor so harnesses spawn the server against THIS
    // sidecar's data dir no matter what cwd they launch from (without
    // INFSTUDIO_USER_DATA_DIR a foreign-cwd spawn would open ~/.infinity-studio/sqlite.db
    // and see a disabled server).
    let stdio: { command: string; args: string[]; env: Record<string, string>; available: boolean } | null = null;
    try {
      const entry = path.join(process.cwd(), "lib/agents/mcp/external-stdio.ts");
      const bunBin = process.execPath.includes("bun") ? process.execPath : "bun";
      stdio = {
        command: bunBin,
        args: ["run", entry],
        env: { INFSTUDIO_USER_DATA_DIR: process.env.INFSTUDIO_USER_DATA_DIR || process.cwd() },
        available: fs.existsSync(entry),
      };
    } catch {
      stdio = null;
    }
    res.json({
      success: true,
      data: {
        config: toMcpConfigSummary(config),
        modes: listMcpModes(config.customModes),
        connections: toPublicConnectionList(all, config.exposedConnectionIds),
        // NOTE: the MCP HTTP endpoint lives on THIS sidecar (same port),
        // not a separate port — clients use `${sidecar-origin}/mcp`.
        httpPath: "/mcp",
        stdio,
      },
    });
  } catch (e: any) {
    res.json({ success: false, error: e.message });
  }
});

app.put("/api/mcp/config", async (req, res) => {
  try {
    const { loadMcpExternalConfig, saveMcpExternalConfig, sanitizeMcpExternalConfig, toMcpConfigSummary, listMcpModes } = await import("../lib/agents/mcp/external-config");
    const current = await loadMcpExternalConfig();
    // Preserve the existing token unless the client explicitly rotates it —
    // the GET summary never includes the secret, so echo-back would wipe it.
    const merged = sanitizeMcpExternalConfig({ ...req.body, authToken: current.authToken });
    if (req.body?.authToken && typeof req.body.authToken === "string" && req.body.authToken.length > 0) {
      merged.authToken = String(req.body.authToken).slice(0, 200);
    }
    const hadToken = current.authToken.length > 0;
    const saved = await saveMcpExternalConfig(merged);
    // If enabling minted a brand-new token, return it once so the UI can show it.
    const mintedToken = !hadToken && saved.authToken ? saved.authToken : undefined;
    res.json({ success: true, data: { config: toMcpConfigSummary(saved), modes: listMcpModes(saved.customModes), mintedToken } });
  } catch (e: any) {
    res.json({ success: false, error: e.message });
  }
});

app.post("/api/mcp/config/regenerate-token", async (_req, res) => {
  try {
    const { loadMcpExternalConfig, saveMcpExternalConfig, generateMcpAuthToken } = await import("../lib/agents/mcp/external-config");
    const current = await loadMcpExternalConfig();
    current.authToken = generateMcpAuthToken();
    await saveMcpExternalConfig(current);
    res.json({ success: true, data: { authToken: current.authToken } });
  } catch (e: any) {
    res.json({ success: false, error: e.message });
  }
});

// Reveal the current token (localhost sidecar only — same trust level as the
// other /api routes, which freely return connection details in dev).
app.get("/api/mcp/config/token", async (_req, res) => {
  try {
    const { loadMcpExternalConfig } = await import("../lib/agents/mcp/external-config");
    const current = await loadMcpExternalConfig();
    if (!current.authToken) {
      res.json({ success: false, error: "No token set yet. Enable the MCP server first." });
      return;
    }
    res.json({ success: true, data: { authToken: current.authToken } });
  } catch (e: any) {
    res.json({ success: false, error: e.message });
  }
});

// Server-side MCP audit log (writes + query cost). Same localhost trust level
// as the other /api/mcp routes. Query params: limit (1-500), writesOnly=1,
// tool=<name>, connectionId=<id>.
app.get("/api/mcp/audit-log", async (req, res) => {
  try {
    const { listMcpAuditLog } = await import("../lib/agents/mcp/audit-log");
    const q = req.query as Record<string, string | undefined>;
    const connectionId = q.connectionId !== undefined ? Number(q.connectionId) : undefined;
    const entries = await listMcpAuditLog({
      limit: q.limit !== undefined ? Number(q.limit) : 100,
      writesOnly: q.writesOnly === "1" || q.writesOnly === "true",
      tool: q.tool || undefined,
      connectionId: connectionId !== undefined && Number.isInteger(connectionId) ? connectionId : undefined,
    });
    res.json({ success: true, data: { entries } });
  } catch (e: any) {
    res.json({ success: false, error: e.message });
  }
});

app.post("/api/mcp/modes", async (req, res) => {
  try {
    const { loadMcpExternalConfig, saveMcpExternalConfig, sanitizeMcpExternalConfig } = await import("../lib/agents/mcp/external-config");
    const config = await loadMcpExternalConfig();
    const raw = req.body || {};
    const id = `custom:${Date.now().toString(36)}`;
    const mode = {
      id,
      label: String(raw.label || "Custom").slice(0, 80),
      kind: "custom" as const,
      description: typeof raw.description === "string" ? raw.description.slice(0, 500) : undefined,
      allowSqlRead: raw.allowSqlRead !== false,
      allowSqlWrite: raw.allowSqlWrite === true,
      promptRules: typeof raw.promptRules === "string" ? raw.promptRules.slice(0, 8000) : "",
    };
    config.customModes = [...(config.customModes || []), mode].slice(0, 50);
    const saved = await saveMcpExternalConfig(sanitizeMcpExternalConfig(config));
    res.json({ success: true, data: { mode, modes: [...(await import("../lib/agents/mcp/external-config")).listMcpModes(saved.customModes)] } });
  } catch (e: any) {
    res.json({ success: false, error: e.message });
  }
});

app.put("/api/mcp/modes/:id", async (req, res) => {
  try {
    const { loadMcpExternalConfig, saveMcpExternalConfig, sanitizeMcpExternalConfig, listMcpModes } = await import("../lib/agents/mcp/external-config");
    const config = await loadMcpExternalConfig();
    const id = String(req.params.id);
    const body = req.body || {};
    config.customModes = (config.customModes || []).map((m: any) =>
      m.id === id
        ? {
            ...m,
            label: typeof body.label === "string" ? body.label.slice(0, 80) : m.label,
            description: typeof body.description === "string" ? body.description.slice(0, 500) : m.description,
            allowSqlRead: body.allowSqlRead !== undefined ? body.allowSqlRead !== false : m.allowSqlRead,
            allowSqlWrite: body.allowSqlWrite !== undefined ? body.allowSqlWrite === true : m.allowSqlWrite,
            promptRules: typeof body.promptRules === "string" ? body.promptRules.slice(0, 8000) : m.promptRules,
          }
        : m,
    );
    const saved = await saveMcpExternalConfig(sanitizeMcpExternalConfig(config));
    res.json({ success: true, data: { modes: listMcpModes(saved.customModes) } });
  } catch (e: any) {
    res.json({ success: false, error: e.message });
  }
});

app.delete("/api/mcp/modes/:id", async (req, res) => {
  try {
    const { loadMcpExternalConfig, saveMcpExternalConfig, sanitizeMcpExternalConfig, listMcpModes } = await import("../lib/agents/mcp/external-config");
    const { INFSTUDIO_PLAN_MODE } = await import("../lib/agents/app-modes");
    const config = await loadMcpExternalConfig();
    const id = String(req.params.id);
    config.customModes = (config.customModes || []).filter((m: any) => m.id !== id);
    if (config.modeId === id) config.modeId = INFSTUDIO_PLAN_MODE.id;
    const saved = await saveMcpExternalConfig(sanitizeMcpExternalConfig(config));
    res.json({ success: true, data: { modes: listMcpModes(saved.customModes), modeId: saved.modeId } });
  } catch (e: any) {
    res.json({ success: false, error: e.message });
  }
});

// Streamable-HTTP MCP endpoint (stateless). Bearer-authenticated with the MCP
// token from Settings → MCP Server; independent from INFSTUDIO_API_KEY.
// Not registered at all when INFSTUDIO_MCP_DISABLED is set (containers).
const mcpHttpHandler: express.RequestHandler = async (req, res) => {
  try {
    const { loadMcpExternalConfig } = await import("../lib/agents/mcp/external-config");
    const { handleMcpHttpRequest, isMcpBearerAuthorized } = await import("../lib/agents/mcp/http");
    const config = await loadMcpExternalConfig();
    if (!config.enabled || (config.transports !== "http" && config.transports !== "both")) {
      res.status(503).json({ success: false, error: "MCP HTTP transport is disabled. Enable it in Settings → MCP Server." });
      return;
    }
    if (!isMcpBearerAuthorized(req, config.authToken)) {
      res.status(401).json({ success: false, error: "Unauthorized. Provide Authorization: Bearer <mcp-token>." });
      return;
    }
    await handleMcpHttpRequest(req, res);
  } catch (e: any) {
    if (!res.headersSent) res.status(500).json({ success: false, error: e.message });
  }
};
if (!cfg.mcpDisabled) app.all("/mcp", mcpHttpHandler);

// SQL query execution
app.post("/api/sql/run", async (req, res) => {
  try {
    assertEmbedRequest(req);
    const { connectionString, query, params, options } = req.body;
    const result = await mod.runQuery(connectionString, query, params || [], options || {});
    res.json(result);
  } catch (e: any) {
    if (respondEmbedFailure(embed, req, res, e)) return;
    res.json({ success: false, error: e.message });
  }
});

app.post("/api/sql/cancel", async (req, res) => {
  try {
    const { connectionString, queryId } = req.body;
    const result = await mod.cancelRunningQuery(connectionString, queryId);
    res.json(result);
  } catch (e: any) {
    res.json({ success: false, error: e.message });
  }
});

// Schema & tables
app.post("/api/schema", async (req, res) => {
  try {
    assertEmbedRequest(req);
    const { connectionString, options } = req.body;
    const result = await mod.fetchSchemas(connectionString, cacheOptionsFor(req, options));
    res.json(result);
  } catch (e: any) {
    if (respondEmbedFailure(embed, req, res, e)) return;
    res.json({ success: false, error: e.message });
  }
});

app.post("/api/tables", async (req, res) => {
  try {
    assertEmbedRequest(req);
    const { connectionString, schema, options } = req.body;
    const result = await mod.fetchTables(connectionString, schema, cacheOptionsFor(req, options));
    res.json(result);
  } catch (e: any) {
    if (respondEmbedFailure(embed, req, res, e)) return;
    res.json({ success: false, error: e.message });
  }
});

app.post("/api/tables-with-columns", async (req, res) => {
  try {
    assertEmbedRequest(req);
    const { connectionString, options } = req.body;
    const result = await mod.fetchAllTablesWithColumns(connectionString, cacheOptionsFor(req, options));
    res.json(result);
  } catch (e: any) {
    if (respondEmbedFailure(embed, req, res, e)) return;
    res.json({ success: false, error: e.message });
  }
});

app.post("/api/tables/search-all", async (req, res) => {
  try {
    assertEmbedRequest(req);
    const { searchAllTables } = await import("../lib/db/actions");
    const { connectionString, searchTerm, schema, connectionType } = req.body;
    const result = await searchAllTables(connectionString, searchTerm, { schema, connectionType });
    res.json(result);
  } catch (e: any) {
    if (respondEmbedFailure(embed, req, res, e)) return;
    res.json({ success: false, error: e.message });
  }
});

// Search index routes (local SQLite cache for universal search)
app.post("/api/search-index/query", simplePostRoute(async body => searchLocalIndex(body.connectionString, body.term)));

app.post("/api/search-index/save", simplePostRoute(async body => saveSearchResultsToIndex(body.connectionString, body.results)));

app.post("/api/search-index/clear", simplePostRoute(async body => clearSearchIndex(body.connectionString)));

app.post("/api/search-index/status", simplePostRoute(async body => getSearchIndexStatus(body.connectionString)));

app.post("/api/table-structure", proxyThreeArgRoute(mod.fetchTableStructure));

app.post("/api/table-foreign-keys", proxyThreeArgRoute(mod.fetchTableForeignKeys));

app.post("/api/referenced-record", async (req, res) => {
  try {
    const { connectionString, schema, table, keyValues } = req.body;
    const result = await mod.fetchReferencedRecord(connectionString, schema, table, keyValues);
    res.json(result);
  } catch (e: any) {
    res.json({ success: false, error: e.message });
  }
});

app.post("/api/functions", proxyTwoArgRoute(mod.fetchFunctions));

app.post("/api/databases", async (req, res) => {
  try {
    const { connectionString, connectionType } = req.body;
    const result = await mod.fetchDatabases(connectionString, connectionType);
    res.json(result);
  } catch (e: any) {
    res.json({ success: false, error: e.message });
  }
});

// Table row operations
app.post("/api/table/update-rows", async (req, res) => {
  try {
    const { connectionString, schema, table, rows } = req.body;
    const result = await mod.updateTableRows(connectionString, schema, table, rows);
    res.json(result);
  } catch (e: any) {
    res.json({ success: false, error: e.message });
  }
});

app.post("/api/table/delete-rows", async (req, res) => {
  try {
    const { connectionString, schema, table, pkValues } = req.body;
    const result = await mod.deleteTableRows(connectionString, schema, table, pkValues);
    res.json(result);
  } catch (e: any) {
    res.json({ success: false, error: e.message });
  }
});

// Extensions, triggers, indexes, enums, etc.
app.post("/api/extensions", proxyOneArgRoute(mod.fetchExtensions));

app.post("/api/triggers", proxyTwoArgRoute(mod.fetchTriggers));

app.post("/api/enums", proxyOneArgRoute(mod.fetchEnums));

app.post("/api/indexes", proxyTwoArgRoute(mod.fetchIndexes));

app.post("/api/views", proxyTwoArgRoute(mod.fetchViews));

app.post("/api/rls-policies", async (req, res) => {
  try {
    const { connectionString, schema, table } = req.body;
    const result = await mod.fetchRlsPolicies(connectionString, schema ?? null, table ?? null);
    res.json(result);
  } catch (e: any) {
    res.json({ success: false, error: e.message });
  }
});

app.post("/api/postgres-roles", proxyOneArgRoute(mod.fetchPostgresRoles));

app.post("/api/table-security-info", proxyTwoArgRoute(mod.fetchTableSecurityInfo));

app.post("/api/supabase-auth-users", async (req, res) => {
  try {
    const { connectionString } = req.body || {};
    const result = await mod.fetchSupabaseAuthUsers(connectionString);
    res.json(result);
  } catch (e: any) {
    res.json({ success: false, error: e.message });
  }
});

app.post("/api/sessions", proxyOneArgRoute(mod.fetchSessions));

app.post("/api/sessions/kill", proxyTwoArgRoute(mod.killSession));

app.post("/api/sessions/cancel-query", proxyTwoArgRoute(mod.cancelSessionQuery));

app.post("/api/locks", proxyOneArgRoute(mod.fetchLocks));

app.post("/api/db-advisor", async (req, res) => {
  try {
    const { connectionString } = req.body;
    const result = await mod.runAdvisorChecks(connectionString);
    res.json({ success: true, data: result });
  } catch (e: any) {
    res.json({ success: false, error: e.message });
  }
});

app.post("/api/explain-plan", async (req, res) => {
  try {
    const { connectionString, query } = req.body;
    const result = await mod.fetchExplainPlan(connectionString, query);
    res.json(result);
  } catch (e: any) {
    res.json({ success: false, error: e.message });
  }
});

app.post("/api/backup/run", async (req, res) => {
  try {
    const { connectionString, options } = req.body;
    const result = await mod.runDbBackup(connectionString, options);
    res.json(result);
  } catch (e: any) {
    res.json({ success: false, error: e.message });
  }
});

// User profile
app.get("/api/user/profile", async (req, res) => {
  try {
    const id = req.query.id as string | undefined;
    const getAll = req.query.getAll as string | undefined;
    if (getAll === "true") {
      const result = await mod.getAllUsers();
      return res.json(result);
    }
    const result = await mod.getStoredUserProfile(id || null);
    res.json(result);
  } catch (e: any) {
    res.json({ success: false, error: e.message });
  }
});

app.post("/api/user/profile", simplePostRoute(mod.upsertUserProfile));

app.delete("/api/user/profile", async (req, res) => {
  try {
    const { id, all } = req.body || {};
    if (all) {
      const result = await mod.clearAllUsers();
      return res.json(result);
    }
    const result = await mod.deleteUserProfile(id);
    res.json(result);
  } catch (e: any) {
    res.json({ success: false, error: e.message });
  }
});

// Error logging
app.post("/api/errors/log", async (req, res) => {
  try {
    const { errorType, message, stack, url, componentStack, metadata, appVersion, os } = req.body || {};
    const bodySize = JSON.stringify(req.body).length;
    if (bodySize > 51200) {
      logToFile("[error-logger] payload too large:", bodySize, "bytes");
      return res.json({ success: false, error: "Payload too large" });
    }
    logToFile(`[error-logger] type=${errorType} msg=${message?.slice(0, 200)} url=${url}`);
    const result = await mod.logAppError({
      errorType: errorType || "unknown",
      message: message || null,
      stack: stack || null,
      url: url || null,
      componentStack: componentStack || null,
      metadata: metadata || {},
      appVersion: appVersion || null,
      os: os || null,
    });
    res.json(result);
  } catch (e: any) {
    res.json({ success: false, error: e.message });
  }
});

// Settings
app.get("/api/app-font", simpleGetRoute(mod.getAppFontFamily));

app.post("/api/app-font", simplePostRoute(body => mod.saveAppFontFamily(body.fontFamily)));

app.get("/api/app-theme", simpleGetRoute(mod.getGlobalAppThemeSettings));

app.post("/api/app-theme", simplePostRoute(mod.saveGlobalAppThemeSettings));

app.get("/api/editor-theme", simpleGetRoute(mod.getGlobalEditorThemeSettings));

app.post("/api/editor-theme", simplePostRoute(mod.saveGlobalEditorThemeSettings));

app.get("/api/studio-settings", simpleGetRoute(mod.getGlobalStudioSettings));

app.post("/api/studio-settings", simplePostRoute(mod.saveGlobalStudioSettings));

// Settings migration
app.get("/api/settings/migration-status", async (_req, res) => {
  try {
    const result = await mod.isMigrationNeeded();
    res.json({ success: true, data: { migrationNeeded: result } });
  } catch (e: any) {
    res.json({ success: false, error: e.message });
  }
});

app.post("/api/settings/migrate", async (_req, res) => {
  try {
    const result = await mod.migrateSettingsFromSqlite();
    res.json({ success: result.done, data: result, error: result.error });
  } catch (e: any) {
    res.json({ success: false, error: e.message });
  }
});

app.post("/api/settings/clear-migrated", async (_req, res) => {
  try {
    await mod.clearMigratedSqliteSettings();
    res.json({ success: true });
  } catch (e: any) {
    res.json({ success: false, error: e.message });
  }
});

// Snapshot create stream (SSE)
app.post("/api/snapshots/create-stream", async (req, res) => {
  const { handleSnapshotCreateStream } = await import("./snapshot-stream");
  await handleSnapshotCreateStream(req, res);
});

// Actions dispatch over the explicit table in server/api-actions.ts (no reflection over module exports)
app.post("/api/actions/:action", async (req, res) => {
  const { action } = req.params;
  const rule = lookupAction(action);
  if (!rule) {
    return res.status(404).json({ success: false, error: `Unknown action: ${action}` });
  }
  const args: unknown[] = Array.isArray(req.body?.args) ? req.body.args : [];
  try {
    const result = await rule.fn(...args);
    res.json(result || { success: true });
  } catch (e: any) {
    res.json({ success: false, error: e.message });
  }
});

// Studio routes
app.get("/studio/:connectionId/folders", studioGetRoute(mod.getStudioFolders));
app.post("/studio/:connectionId/folders", studioPostRoute(mod.saveStudioFolders));

app.get("/studio/:connectionId/snippets", async (req, res) => {
  try {
    const connectionId = Number(req.params.connectionId);
    const result = await mod.getStudioSnippets(connectionId);
    log("[infinity-studio:snapshot] Server getStudioSnippets for", connectionId, {
      success: result?.success,
      count: result?.data?.length ?? 0,
      ids: (result?.data ?? []).map((s: any) => s.id),
      names: (result?.data ?? []).map((s: any) => s.name),
    });
    res.json(result);
  } catch (e: any) {
    res.json({ success: false, error: e.message });
  }
});

app.post("/studio/:connectionId/snippets", async (req, res) => {
  try {
    const connectionId = Number(req.params.connectionId);
    const body = req.body;
    log("[infinity-studio:snapshot] Server saveStudioSnippets received", {
      connectionId,
      snippetCount: Array.isArray(body) ? body.length : typeof body,
      snippetIds: Array.isArray(body) ? body.map((s: any) => s?.id) : [],
      snippetNames: Array.isArray(body) ? body.map((s: any) => s?.name) : [],
    });
    const result = await mod.saveStudioSnippets(connectionId, body);
    log("[infinity-studio:snapshot] Server saveStudioSnippets result", result);
    res.json(result);
  } catch (e: any) {
    console.error("[infinity-studio:snapshot] Server saveStudioSnippets error", e);
    res.json({ success: false, error: e.message });
  }
});

app.get("/studio/:connectionId/history", studioGetRoute(mod.getStudioHistory));
app.post("/studio/:connectionId/history", studioPostRoute(mod.saveStudioHistory));

app.post("/studio/:connectionId/history/entry", async (req, res) => {
  try {
    const result = await mod.insertHistoryEntry(Number(req.params.connectionId), req.body);
    res.json(result);
  } catch (e: any) {
    res.json({ success: false, error: e.message });
  }
});

app.delete("/studio/:connectionId/history", async (req, res) => {
  try {
    const result = await mod.clearStudioHistory(Number(req.params.connectionId));
    res.json(result);
  } catch (e: any) {
    res.json({ success: false, error: e.message });
  }
});

app.get("/studio/:connectionId/tags", studioGetRoute(mod.getStudioTags));
app.post("/studio/:connectionId/tags", studioPostRoute(mod.saveStudioTags));

app.get("/studio/:connectionId/table-tags", studioGetRoute(mod.getStudioTableTags));
app.post("/studio/:connectionId/table-tags", studioPostRoute(mod.saveStudioTableTags));

app.get("/studio/:connectionId/tabs", studioGetRoute(mod.getStudioTabs));
app.post("/studio/:connectionId/tabs", studioPostRoute(mod.saveStudioTabs));

app.get("/studio/:connectionId/settings", studioGetRoute(mod.getStudioSettings));
app.post("/studio/:connectionId/settings", studioPostRoute(mod.saveStudioSettings));

app.get("/studio/:connectionId/dashboards", studioGetRoute(mod.getStudioDashboards));
app.post("/studio/:connectionId/dashboards", studioPostRoute(mod.saveStudioDashboards));

app.get("/studio/:connectionId/notes", studioGetRoute(mod.getStudioNotes));
app.post("/studio/:connectionId/notes", studioPostRoute(mod.saveStudioNotes));

app.get("/studio/:connectionId/bootstrap", async (req, res) => {
  try {
    const rawId = req.params.connectionId;
    const numericId = Number(rawId);
    const requestedSchema = req.query.s as string | undefined;
    const result = await mod.getStudioBootstrap(numericId, requestedSchema || null);

    // If bootstrap found a connection locally, return it as-is
    if (result?.success && result.data?.connection) {
      return res.json(result);
    }

    res.json(result);
  } catch (e: any) {
    res.json({ success: false, error: e.message });
  }
});

// AI routes (basic - list chats, get messages)
app.get("/api/ai/chats", async (req, res) => {
  try {
    const connectionId = Number(req.query.connectionId);
    const result = await mod.listAiChats(connectionId);
    res.json(result);
  } catch (e: any) {
    res.json({ success: false, error: e.message });
  }
});

app.get("/api/ai/settings", simpleGetRoute(mod.getGlobalAiSettings));

app.get("/api/ai/providers", simpleGetRoute(async () => {
  const { listAiProviderCatalog } = await import("../lib/ai/pi-provider-catalog");
  return listAiProviderCatalog();
}));

app.post("/api/ai/settings", simplePostRoute(body => mod.saveGlobalAiSettings(body.settings)));

app.get("/api/keybindings", simpleGetRoute(async () => {
  const { getKeybindings } = await import("../lib/db/keybindings-store");
  return getKeybindings();
}));

app.post("/api/keybindings", simplePostRoute(async (body) => {
  const { saveKeybindings } = await import("../lib/db/keybindings-store");
  return saveKeybindings(body.keybindings);
}));

// JSON-file-backed chat storage for Studio AI assistant
import {
  saveChatMessages as jsonSaveChat,
  loadChatMessages as jsonLoadChat,
  listChats as jsonListChats,
  deleteChat as jsonDeleteChat,
} from "../lib/db/chat-json-storage";

app.get("/api/studio/chats", async (req, res) => {
  try {
    const connectionId = Number(req.query.connectionId);
    const result = jsonListChats(connectionId);
    res.json(result);
  } catch (e: any) {
    res.json({ success: false, error: e.message });
  }
});

app.get("/api/studio/chats/:chatId", async (req, res) => {
  try {
    const connectionId = Number(req.query.connectionId);
    const result = jsonLoadChat(req.params.chatId, connectionId);
    res.json(result);
  } catch (e: any) {
    res.json({ success: false, error: e.message });
  }
});

app.post("/api/studio/chats/:chatId/save", async (req, res) => {
  try {
    const { connectionId, title, messages } = req.body;
    const result = jsonSaveChat(req.params.chatId, Number(connectionId), title || "Chat", messages || []);
    res.json(result);
  } catch (e: any) {
    res.json({ success: false, error: e.message });
  }
});

app.delete("/api/studio/chats/:chatId", async (req, res) => {
  try {
    const connectionId = Number(req.query.connectionId);
    const result = jsonDeleteChat(req.params.chatId, connectionId);
    res.json(result);
  } catch (e: any) {
    res.json({ success: false, error: e.message });
  }
});

// ─── Route-handler factories (eliminate try/catch/tryProxy boilerplate) ──────
type Handler = (req: any, res: any) => Promise<void>;

/** GET /studio/:connectionId/X — extract connectionId, call mod.fn(id) */
function studioGetRoute(fn: (id: number) => Promise<any>): Handler {
  return async (req, res) => {
    try {
      res.json(await fn(Number(req.params.connectionId)));
    } catch (e: any) { res.json({ success: false, error: e.message }); }
  };
}

/** POST /studio/:connectionId/X — extract connectionId + body, call mod.fn(id, body) */
function studioPostRoute(fn: (id: number, body: any) => Promise<any>): Handler {
  return async (req, res) => {
    try {
      res.json(await fn(Number(req.params.connectionId), req.body));
    } catch (e: any) { res.json({ success: false, error: e.message }); }
  };
}

/** GET /api/X — zero-arg mod.fn() */
function simpleGetRoute(fn: () => Promise<any>): Handler {
  return async (_req, res) => {
    try {
      res.json(await fn());
    } catch (e: any) { res.json({ success: false, error: e.message }); }
  };
}

/** POST /api/X — extract connectionString, call mod.fn(cs) */
function proxyOneArgRoute(fn: (cs: string) => Promise<any>): Handler {
  return async (req, res) => {
    try {
      res.json(await fn(req.body.connectionString));
    } catch (e: any) { res.json({ success: false, error: e.message }); }
  };
}

/** POST /api/X — extract connectionString, schema */
// fallow-ignore-next-line code-duplication
function proxyTwoArgRoute(fn: (cs: string, schema: string) => Promise<any>): Handler {
  return async (req, res) => {
    try {
      res.json(await fn(req.body.connectionString, req.body.schema));
    } catch (e: any) { res.json({ success: false, error: e.message }); }
  };
}

/** POST /api/X — extract connectionString, schema, table */
// fallow-ignore-next-line code-duplication
function proxyThreeArgRoute(fn: (cs: string, schema: string, table: string) => Promise<any>): Handler {
  return async (req, res) => {
    try {
      res.json(await fn(req.body.connectionString, req.body.schema, req.body.table));
    } catch (e: any) { res.json({ success: false, error: e.message }); }
  };
}

/** POST /api/X — pass req.body to fn, return result */
function simplePostRoute(fn: (body: any) => Promise<any>): Handler {
  return async (req, res) => {
    try {
      res.json(await fn(req.body));
    } catch (e: any) { res.json({ success: false, error: e.message }); }
  };
}

/** Dynamic-import the workflow dependencies (better-drizzle client, ensureCoreTables) */
async function getWorkflowDeps() {
  const { client } = await import("../lib/db/index");
  const { ensureCoreTables } = await import("../lib/db/ensure-core-tables");
  await ensureCoreTables();
  return { client };
}

// Notifications
app.get("/api/notifications", (req, res) => {
  res.json({ success: true, notifications: [] });
});

app.post("/api/notifications/mark-read", (req, res) => {
  res.json({ success: true });
});

// Analytics
app.get("/api/user/analytics", async (req, res) => {
  try {
    const result = await mod.getUserAnalytics();
    res.json(result);
  } catch (e: any) {
    res.json({ success: false, error: e.message });
  }
});

app.get("/api/connections/:id/analytics", async (req, res) => {
  try {
    const connectionId = parseInt(req.params.id, 10);
    if (isNaN(connectionId)) {
      res.json({ success: false, error: "Invalid connection ID" });
      return;
    }
    const range = req.query.range as string | undefined;
    const result = await mod.getConnectionAnalytics(connectionId, range);
    res.json(result);
  } catch (e: any) {
    res.json({ success: false, error: e.message });
  }
});

// Agents
app.get("/api/agents", (_req, res) => {
  res.json({ agents: [] });
});

// AI chat messages
app.get("/api/ai/chats/:chatId/messages", async (req, res) => {
  try {
    const result = await mod.getAiChatMessages(req.params.chatId);
    res.json(result);
  } catch (e: any) {
    res.json({ success: false, error: e.message });
  }
});

app.post("/api/ai/chats/:chatId/messages", async (req, res) => {
  log("[infinity-studio:chat] POST messages chatId=%s action=%s", req.params.chatId, req.body?.action);
  try {
    const { action, ...payload } = req.body;
    switch (action) {
      case "append": {
        const result = await mod.appendAiChatMessage({ ...payload, chatId: req.params.chatId });
        return res.json(result);
      }
      case "update_content": {
        const result = await mod.updateAiChatMessageContent({ ...payload, chatId: req.params.chatId });
        return res.json(result);
      }
      case "update_meta": {
        const result = await mod.updateAiChatMessageMeta({ ...payload, chatId: req.params.chatId });
        return res.json(result);
      }
      case "delete_after": {
        const result = await mod.deleteAiChatMessagesAfter({ ...payload, chatId: req.params.chatId });
        return res.json(result);
      }
      case "ensure": {
        const result = await mod.ensureAiChat(payload);
        return res.json(result);
      }
      default:
        return res.json({ success: false, error: `Unknown action: ${action}` });
    }
  } catch (e: any) {
    res.json({ success: false, error: e.message });
  }
});

async function resolveAiReq(req: any, res: any) {
  const {
    provider, model, prompt, connectionString, dbType,
    selectedNamespace, lightSchemaContext,
    schemaContext: altSchemaContext, defaultSchema, apiKey: directApiKey,
    connectionId: rawConnectionId,
  } = req.body;

  if (!provider || !model || !prompt || !connectionString || !dbType) {
    res.status(400).json({ error: "Missing required fields: provider, model, prompt, connectionString, dbType" });
    return null;
  }

  const settingsResult = await mod.getGlobalAiSettings();
  if (!settingsResult.success) {
    res.status(500).json({ error: "Failed to load AI settings." });
    return null;
  }

  const settings = settingsResult.data;

  if (directApiKey) {
    settings.providers[provider] = settings.providers[provider] || { apiKey: "", models: [] };
    settings.providers[provider].apiKey = directApiKey;
  }

  if (!settings.providers[provider] || !settings.providers[provider].apiKey.trim()) {
    res.status(400).json({ error: `AI provider "${provider}" is not configured.` });
    return null;
  }

  const schemaContext = lightSchemaContext || altSchemaContext || [];
  const namespace = selectedNamespace || defaultSchema || undefined;
  const connectionId = rawConnectionId ? Number(rawConnectionId) : null;

  return { provider, model, prompt, connectionString, dbType, settings, schemaContext, namespace, connectionId };
}

/** Build the create_workflow persistence hook for AI tools (null when unlinked). */
function makePersistWorkflow(connectionId: number | null) {
  if (!connectionId || Number.isNaN(connectionId)) return undefined;
  return async (input: { name: string; description?: string }) => {
    const { client } = await getWorkflowDeps();
    const now = Date.now();
    const row = {
      id: workflowId(),
      connectionId,
      name: String(input.name || "Untitled Workflow"),
      description: input.description || null,
      nodesJson: "[]",
      edgesJson: "[]",
      scheduleEnabled: false,
      scheduleType: null,
      scheduleValue: null,
      createdAt: now,
      updatedAt: now,
    };
    await client.workflows.create({ data: row as any });
    return { id: row.id, name: row.name };
  };
}

function handleSseError(error: any, label: string, res: any) {
  const message = error instanceof Error ? error.message : String(error ?? "Unknown error");
  console.error(`[${label}] error:`, message);
  if (error?.stack && !(error instanceof Error && error.message === error.stack)) {
    console.error(`[${label}] stack:`, error.stack);
  }
  if (res.headersSent) {
    res.write(`data: ${JSON.stringify({ type: "error", message })}\n\n`);
    res.end();
  } else {
    res.status(500).json({ error: message });
  }
}

function setupSsePiAgent(req: any, res: any) {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  let aborted = false;
  req.on("close", () => { aborted = true; });

  const emitSse = (event: PiSseEvent) => {
    if (aborted) return;
    switch (event.type) {
      case "step":
        res.write(`data: ${JSON.stringify({ type: "step", message: event.message })}\n\n`);
        break;
      case "assistant_delta":
        res.write(`data: ${JSON.stringify({ type: "assistant_delta", message: event.message })}\n\n`);
        break;
      case "tool_start":
        res.write(`data: ${JSON.stringify({ type: "tool_start", tool: "", command: event.command })}\n\n`);
        break;
      case "tool_output":
        res.write(`data: ${JSON.stringify({ type: "tool_output", output: event.output })}\n\n`);
        break;
      case "tool_end":
        res.write(`data: ${JSON.stringify({ type: "tool_end", exitCode: event.exitCode })}\n\n`);
        break;
    }
  };

  return { aborted, emitSse };
}

// Agent / SQL stream routes
app.post("/api/agent/chat/stream", async (req, res) => {
  try {
    const { history, lightDashboardContext, lightWorkflowContext, permissionMode } = req.body;
    const resolved = await resolveAiReq(req, res);
    if (!resolved) return;
    const { provider, model, prompt, connectionString, dbType, settings, schemaContext, namespace } = resolved;
    const dashboardContext = lightDashboardContext || [];

    const { aborted, emitSse } = setupSsePiAgent(req, res);

    const piInput: PiAgentInput = {
      settings,
      provider,
      model,
      permissionMode: permissionMode || "schema_only",
      connectionString,
      connectionId: resolved.connectionId ?? null,
      persistWorkflow: makePersistWorkflow(resolved.connectionId ?? null),
      dbType,
      selectedNamespace: namespace,
      schemaContext,
      dashboardContext,
      workflowContext: lightWorkflowContext || { existing: [], current: null },
      workingDirectory: getAgentSandboxCwd(),
      emitStep: (message: string) => {
        if (!aborted) {
          res.write(`data: ${JSON.stringify({ type: "tool_start", tool: "", input: { message }, label: message })}\n\n`);
        }
      },
    };

    const { session, dispose } = await createInfinityStudioPiSession(piInput);

    let fullText = "";
    try {
      fullText = await streamPiResponse({
        session,
        history: history || [],
        prompt,
        emit: emitSse,
        isAborted: () => aborted,
      });
    } finally {
      dispose();
    }

    if (!aborted) {
      res.write(`data: ${JSON.stringify({ type: "assistant_done", message: fullText })}\n\n`);
    }
    res.end();
  } catch (error: any) {
    handleSseError(error, "agent/chat/stream", res);
  }
});

app.post("/api/agent/approval/submit", async (req, res) => {
  try {
    const { toolCallId, answers } = req.body as { toolCallId?: string; answers?: unknown };
    if (!toolCallId) {
      return res.status(400).json({ error: "toolCallId required" });
    }
    const { resolvePendingApproval } = await import("../lib/ai/pending-approvals");
    const ok = resolvePendingApproval(String(toolCallId), answers);
    if (!ok) {
      return res.status(404).json({ error: "No pending approval for this ID. It may have timed out." });
    }
    res.json({ ok: true, toolCallId });
  } catch (e: any) {
    res.status(500).json({ error: e?.message || "Failed to submit approval" });
  }
});

app.post("/api/agent/generate-dashboard/stream", async (req, res) => {
  try {
    const { permissionMode } = req.body;
    const resolved = await resolveAiReq(req, res);
    if (!resolved) return;
    const { provider, model, prompt, connectionString, dbType, settings, schemaContext, namespace } = resolved;

    const { aborted, emitSse } = setupSsePiAgent(req, res);

    const piInput: PiAgentInput = {
      settings,
      provider,
      model,
      permissionMode: permissionMode || "schema_only",
      connectionString,
      dbType,
      selectedNamespace: namespace,
      schemaContext,
      dashboardContext: [],
      workingDirectory: getAgentSandboxCwd(),
      emitStep: (message: string) => {
        if (!aborted) {
          res.write(`data: ${JSON.stringify({ type: "tool_start", tool: "", input: { message }, label: message })}\n\n`);
        }
      },
    };

    const { session, dispose } = await createInfinityStudioPiSession(piInput);

    let fullText = "";
    try {
      fullText = await streamPiResponse({
        session,
        history: [],
        prompt,
        emit: emitSse,
        isAborted: () => aborted,
      });
    } finally {
      dispose();
    }

    if (!aborted) {
      const dashboardPlan = extractDashboardPlan(fullText);
      if (dashboardPlan) {
        res.write(`data: ${JSON.stringify({ type: "result", message: "Dashboard plan generated.", data: dashboardPlan })}\n\n`);
      } else {
        res.write(`data: ${JSON.stringify({ type: "assistant", message: fullText })}\n\n`);
      }
    }
    res.end();
  } catch (error: any) {
    handleSseError(error, "agent/generate-dashboard/stream", res);
  }
});

function extractDashboardPlan(text: string): { name?: string; widgets?: unknown[]; assistantMessage?: string } | null {
  const match = text.match(/```dashboard\n?([\s\S]*?)```/);
  const jsonStr = match?.[1]?.trim();
  if (!jsonStr) return null;
  try {
    const parsed = JSON.parse(jsonStr);
    return {
      name: parsed.name || parsed.title,
      widgets: parsed.widgets,
      assistantMessage: text.replace(/```dashboard[\s\S]*?```/, "").trim(),
    };
  } catch {
    return null;
  }
}

app.post("/api/sql/cancel", (req, res) => {
  res.json({ success: true });
});

// Tauri updater placeholder
app.get("/api/updates/check", async (_req, res) => {
  res.json({ success: true, updateAvailable: false });
});

// ─── Workflows ────────────────────────────────────────────────────────────────

function workflowId() {
  return `wf_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}
function runId() {
  return `run_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

app.get("/api/workflows", async (req, res) => {
  try {
    const { client } = await getWorkflowDeps();
    const connectionId = Number(req.query.connectionId);
    if (!connectionId || Number.isNaN(connectionId)) {
      res.json({ success: true, data: [] });
      return;
    }
    const rows = await client.workflows.findMany({ where: { connectionId } });
    res.json({ success: true, data: rows });
  } catch (e: any) {
    res.json({ success: false, error: e.message });
  }
});

app.post("/api/workflows", async (req, res) => {
  try {
    const { client } = await getWorkflowDeps();
    const now = Date.now();
    const row = {
      id: workflowId(),
      connectionId: req.body.connectionId ? Number(req.body.connectionId) : null,
      name: req.body.name || "Untitled Workflow",
      description: req.body.description || null,
      nodesJson: JSON.stringify(req.body.nodes || []),
      edgesJson: JSON.stringify(req.body.edges || []),
      scheduleEnabled: Boolean(req.body.scheduleEnabled),
      scheduleType: req.body.scheduleType || null,
      scheduleValue: req.body.scheduleValue || null,
      createdAt: now,
      updatedAt: now,
    };
    await client.workflows.create({ data: row as any });
    res.json({ success: true, data: { ...row, nodes: req.body.nodes || [], edges: req.body.edges || [] } });
  } catch (e: any) {
    res.json({ success: false, error: e.message });
  }
});

app.get("/api/workflows/:id", async (req, res) => {
  try {
    const { client } = await getWorkflowDeps();
    const row = await client.workflows.findFirst({ where: { id: req.params.id } });
    if (!row) { res.json({ success: false, error: "Not found" }); return; }
    res.json({ success: true, data: row });
  } catch (e: any) {
    res.json({ success: false, error: e.message });
  }
});

app.put("/api/workflows/:id", async (req, res) => {
  try {
    const { client } = await getWorkflowDeps();
    const updates: Record<string, unknown> = { updatedAt: Date.now() };
    if (req.body.name !== undefined) updates.name = req.body.name;
    if (req.body.description !== undefined) updates.description = req.body.description;
    if (req.body.nodes !== undefined) updates.nodesJson = JSON.stringify(req.body.nodes);
    if (req.body.edges !== undefined) updates.edgesJson = JSON.stringify(req.body.edges);
    if (req.body.scheduleEnabled !== undefined) updates.scheduleEnabled = Boolean(req.body.scheduleEnabled);
    if (req.body.scheduleType !== undefined) updates.scheduleType = req.body.scheduleType;
    if (req.body.scheduleValue !== undefined) updates.scheduleValue = req.body.scheduleValue;
    // fallow-ignore-next-line code-duplication
    await client.workflows.update({ where: { id: req.params.id }, data: updates as any });
    res.json({ success: true });
  } catch (e: any) {
    res.json({ success: false, error: e.message });
  }
});

// fallow-ignore-next-line code-duplication
app.delete("/api/workflows/:id", async (req, res) => {
  try {
    const { client } = await getWorkflowDeps();
    await client.workflows.delete({ where: { id: req.params.id } });
    res.json({ success: true });
  } catch (e: any) {
    res.json({ success: false, error: e.message });
  }
});

app.post("/api/workflows/:id/run", async (req, res) => {
  try {
    const { client } = await getWorkflowDeps();
    const { executeWithMastra } = await import("../lib/workflows/mastra-adapter");

    const wf = await client.workflows.findFirst({ where: { id: req.params.id } });
    if (!wf) { res.json({ success: false, error: "Workflow not found" }); return; }
    // "Run" tests the editor's current canvas, which may have unsaved edits -
    // use the nodes/edges the client sends if provided, falling back to the
    // persisted version for the scheduler and any other caller that omits them.
    const nodes = req.body?.nodes !== undefined ? req.body.nodes : JSON.parse(wf.nodesJson || "[]");
    const edges = req.body?.edges !== undefined ? req.body.edges : JSON.parse(wf.edgesJson || "[]");
    const trigger = (req.body?.trigger as "manual" | "schedule") || "manual";

    const rid = runId();
    const startedAt = Date.now();
    await client.workflowRuns.create({
      data: {
        id: rid,
        workflowId: wf.id,
        status: "running",
        startedAt,
        trigger,
      } as any,
    });

    // Stream node-start/node-done as the workflow actually executes them (the
    // runner already awaits each node in graph order before starting the next)
    // so the client can highlight nodes one at a time instead of only learning
    // the outcome after the whole run finishes.
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    (res as any).flushHeaders?.();
    const send = (event: Record<string, unknown>) => res.write(`data: ${JSON.stringify(event)}\n\n`);

    try {
      const { outputs, error } = await executeWithMastra(
        nodes, edges, trigger, req.body?.initialData, wf.connectionId,
        (event) => send(event),
      );
      const finishedAt = Date.now();
      const status = error ? "error" : "success";
      // fallow-ignore-next-line code-duplication
      await client.workflowRuns.update({
        where: { id: rid },
        data: {
          status,
          finishedAt,
          nodesOutputJson: JSON.stringify(outputs),
          error: error || null,
        } as any,
      });
      // fallow-ignore-next-line code-duplication
      await client.workflows.update({
        where: { id: wf.id },
        data: { lastRunAt: finishedAt, updatedAt: finishedAt } as any,
      });
      send({ type: "run-complete", runId: rid, status, outputs, error });
    } catch (execErr: any) {
      const finishedAt = Date.now();
      await client.workflowRuns.update({
        where: { id: rid },
        data: {
          status: "error",
          finishedAt,
          error: execErr.message,
        } as any,
      });
      send({ type: "run-complete", runId: rid, status: "error", error: execErr.message });
    }
    res.end();
  } catch (e: any) {
    res.json({ success: false, error: e.message });
  }
});

app.get("/api/workflows/:id/runs", async (req, res) => {
  try {
    const { client } = await getWorkflowDeps();
    const limit = Math.min(Number(req.query.limit) || 20, 100);
    const rows = await client.workflowRuns.findMany({
      where: { workflowId: req.params.id },
      orderBy: { startedAt: "desc" },
      take: limit,
    });
    res.json({ success: true, data: rows });
  } catch (e: any) {
    res.json({ success: false, error: e.message });
  }
});

app.get("/api/workflows/:id/runs/:runId", async (req, res) => {
  try {
    const { client } = await getWorkflowDeps();
    const row = await client.workflowRuns.findFirst({
      where: { id: req.params.runId },
    });
    if (!row || (row as any).workflowId !== req.params.id) {
      res.json({ success: false, error: "Run not found" });
      return;
    }
    res.json({ success: true, data: row });
  } catch (e: any) {
    res.json({ success: false, error: e.message });
  }
});

// Cron scheduler — checks every minute for due workflows
(async () => {
  try {
    const { ensureCoreTables } = await import("../lib/db/ensure-core-tables");
    await ensureCoreTables();

      async function runScheduledWorkflows() {
      try {
        const { client } = await import("../lib/db/index");
        const { executeWithMastra, matchesCron } = await import("../lib/workflows/mastra-adapter");

        const enabled = await client.workflows.findMany({ where: { scheduleEnabled: true } });
        const now = new Date();

        for (const wf of enabled) {
          try {
            if (!wf.scheduleType || !wf.scheduleValue) continue;

            let shouldRun = false;
            if (wf.scheduleType === "cron") {
              shouldRun = matchesCron(wf.scheduleValue, now);
            } else if (wf.scheduleType === "datetime") {
              const target = new Date(wf.scheduleValue);
              const diff = Math.abs(now.getTime() - target.getTime());
              const lastRun = wf.lastRunAt || 0;
              shouldRun = diff < 60_000 && (Date.now() - lastRun) > 60_000;
            }

            if (!shouldRun) continue;

            const nodes = JSON.parse(wf.nodesJson || "[]");
            const edges = JSON.parse(wf.edgesJson || "[]");
            const rid = runId();
            const startedAt = Date.now();

            await client.workflowRuns.create({
              data: { id: rid, workflowId: wf.id, status: "running", startedAt, trigger: "schedule" } as any,
            });
            const { outputs, error } = await executeWithMastra(nodes, edges, "schedule", undefined, wf.connectionId);
            const finishedAt = Date.now();
            // fallow-ignore-next-line code-duplication
            await client.workflowRuns.update({
              where: { id: rid },
              data: { status: error ? "error" : "success", finishedAt, nodesOutputJson: JSON.stringify(outputs), error: error || null } as any,
            });
            // fallow-ignore-next-line code-duplication
            await client.workflows.update({
              where: { id: wf.id },
              data: { lastRunAt: finishedAt, updatedAt: finishedAt } as any,
            });
            log(`[workflow-scheduler] ran ${wf.name} (${wf.id}) — ${error ? "error" : "success"}`);
          } catch (err: any) {
            log(`[workflow-scheduler] error running ${wf.id}: ${err.message}`);
          }
        }
      } catch (err: any) {
        log(`[workflow-scheduler] tick error: ${err.message}`);
      }
    }

    setInterval(runScheduledWorkflows, 60_000);
    log("[workflow-scheduler] started");
  } catch (e: any) {
    log("[workflow-scheduler] startup error:", e.message);
  }
})();

// ─────────────────────────────────────────────────────────────────────────────
// Agent Harness Endpoints — cached like t3code's providerStatusCache
// ─────────────────────────────────────────────────────────────────────────────
let providersRefreshPromise: Promise<any> | null = null;

async function refreshProvidersCacheInBackground() {
  if (providersRefreshPromise) return providersRefreshPromise;
  providersRefreshPromise = (async () => {
    try {
      const { detectProviders } = await import("../lib/agents/detect-providers");
      const { listProviderModels } = await import("../lib/agents/list-provider-models");
      const { listProviderModes } = await import("../lib/agents/list-provider-modes");
      const { readServerProviderCache, writeServerProviderCache } = await import(
        "../lib/agents/provider-cache-server"
      );
      const { mergeCachedProviders } = await import("../lib/agents/provider-cache");
      const previous = readServerProviderCache();
      const providers = await detectProviders();
      const providersWithModels = await Promise.all(
        providers.map(async (p) => {
          const [models, modes] = await Promise.all([
            listProviderModels(p.id, p.binaryPath),
            listProviderModes(p.id, p.binaryPath),
          ]);
          return { ...p, models, modes };
        }),
      );
      const merged = mergeCachedProviders(providersWithModels, previous?.providers ?? null);
      writeServerProviderCache(merged);
      return merged;
    } catch (err: any) {
      log("[agents/detect] background refresh error:", err.message);
      return null;
    } finally {
      providersRefreshPromise = null;
    }
  })();
  return providersRefreshPromise;
}

app.get("/api/agents/detect", async (_req, res) => {
  try {
    const { readServerProviderCache, writeServerProviderCache } = await import(
      "../lib/agents/provider-cache-server"
    );
    const cached = readServerProviderCache();
    const now = Date.now();
    const freshMs = 30_000; // 30s fresh, like t3's quick revalidate
    const staleMs = 5 * 60_000; // 5 min stale-while-revalidate
    const isFresh = cached && now - cached.cachedAt < freshMs;
    const isStaleUsable = cached && now - cached.cachedAt < staleMs;

    // Instant path: serve from disk cache (hydrated) — mirrors t3's hydrateCachedProvider
    if (isFresh && cached) {
      res.json({ providers: cached.providers, cached: true });
      return;
    }
    if (isStaleUsable && cached) {
      res.json({ providers: cached.providers, cached: true, stale: true });
      // Revalidate in background without blocking
      void refreshProvidersCacheInBackground();
      return;
    }

    // No usable cache — try to serve stale anyway while we probe, else probe blocking
    if (cached && cached.providers.length > 0) {
      res.json({ providers: cached.providers, cached: true, stale: true });
      void refreshProvidersCacheInBackground();
      return;
    }

    // Cold start: no cache file yet — probe and populate (first run still ~2-3s, then instant)
    const fresh = await refreshProvidersCacheInBackground();
    if (fresh && fresh.length > 0) {
      res.json({ providers: fresh });
      return;
    }
    // Fallback to live probe if background failed
    const { detectProviders } = await import("../lib/agents/detect-providers");
    const { listProviderModels } = await import("../lib/agents/list-provider-models");
    const { listProviderModes } = await import("../lib/agents/list-provider-modes");
    const providers = await detectProviders();
    const providersWithModels = await Promise.all(
      providers.map(async (p) => {
        const [models, modes] = await Promise.all([
          listProviderModels(p.id, p.binaryPath),
          listProviderModes(p.id, p.binaryPath),
        ]);
        return { ...p, models, modes };
      }),
    );
    try {
      writeServerProviderCache(providersWithModels);
    } catch {}
    res.json({ providers: providersWithModels });
  } catch (err: any) {
    log("[agents/detect] error:", err.message);
    // Last resort: try to return stale cache even on error
    try {
      const { readServerProviderCache } = await import("../lib/agents/provider-cache-server");
      const cached = readServerProviderCache();
      if (cached) {
        res.json({ providers: cached.providers, cached: true, stale: true, error: err.message });
        return;
      }
    } catch {}
    res.json({ providers: [], error: err.message });
  }
});

app.get("/api/agents/models/:providerId", async (req, res) => {
  try {
    const providerId = req.params.providerId as any;
    // Instant path via server cache (like t3's ProviderRegistry.getProviders)
    try {
      const { readServerProviderCache } = await import("../lib/agents/provider-cache-server");
      const cached = readServerProviderCache();
      const hit = cached?.providers.find((p) => p.id === providerId);
      if (hit?.models && hit.models.length > 0) {
        res.json({ models: hit.models, cached: true });
        return;
      }
    } catch {}
    const { detectProviders } = await import("../lib/agents/detect-providers");
    const { listProviderModels } = await import("../lib/agents/list-provider-models");
    const providers = await detectProviders();
    const provider = providers.find((p) => p.id === providerId);
    const models = await listProviderModels(providerId, provider?.binaryPath);
    res.json({ models });
  } catch (err: any) {
    log("[agents/models] error:", err.message);
    res.json({ models: [], error: err.message });
  }
});

app.post("/api/agents/chat/stream", async (req, res) => {
  try {
    const {
      provider,
      prompt,
      history,
      connectionId,
      connectionString,
      connectionName,
      dbType,
      schemaContext,
      mode,
      appMode,
    } = req.body;

    if (!provider || !prompt) {
      res.status(400).json({ error: "provider and prompt are required" });
      return;
    }

    const { INFSTUDIO_PLAN_MODE, INFSTUDIO_BUILD_MODE } = await import(
      "../lib/agents/app-modes"
    );
    const resolvedAppMode =
      appMode && typeof appMode === "object" && typeof appMode.id === "string"
        ? {
            id: String(appMode.id),
            label: String(appMode.label || appMode.id),
            kind:
              appMode.kind === "build" || appMode.kind === "custom"
                ? appMode.kind
                : ("plan" as const),
            allowSqlRead: appMode.allowSqlRead !== false,
            allowSqlWrite: appMode.allowSqlWrite === true,
            promptRules: String(appMode.promptRules || ""),
            mapsToProviderMode: appMode.mapsToProviderMode,
          }
        : appMode?.id === "infinity-studio-build"
          ? INFSTUDIO_BUILD_MODE
          : INFSTUDIO_PLAN_MODE;

    // Prefer a per-connection sandbox so schemas never bleed across DBs.
    const agentCwd = getAgentSandboxCwd(connectionId);
    const { materializeAgentSandbox, AGENT_SCHEMA_FILENAME } = await import(
      "../lib/agents/sandbox-cwd"
    );

    // Resolve schema: trust the client when present, otherwise fetch live from the DB.
    let schemaTables = Array.isArray(schemaContext) ? schemaContext : [];
    if (
      schemaTables.length === 0 &&
      typeof connectionString === "string" &&
      connectionString &&
      dbType !== "redis"
    ) {
      try {
        const result = await mod.fetchAllTablesWithColumns(connectionString, {});
        if (result?.success && Array.isArray(result.data)) {
          const { groupSchemaRows } = await import("../lib/ai/schema-grouping");
          schemaTables = groupSchemaRows(result.data);
          log(
            `[agents/chat/stream] loaded ${schemaTables.length} tables server-side for connection`,
            connectionId ?? connectionName ?? "",
          );
        }
      } catch (err: any) {
        log("[agents/chat/stream] server-side schema fetch failed:", err?.message);
      }
    }

    materializeAgentSandbox(agentCwd, {
      dbType: String(dbType || "unknown"),
      connectionName:
        typeof connectionName === "string" && connectionName
          ? connectionName
          : undefined,
      connectionId:
        connectionId !== undefined && connectionId !== null
          ? connectionId
          : undefined,
      schemaContext: schemaTables,
    });
    if (schemaTables.length === 0) {
      log(
        "[agents/chat/stream] warning: schemaContext empty — agent may not see tables",
      );
    }

    if (provider === "infinity-studio") {
      // Route to existing built-in agent — pick the first configured provider
      // (like t3's resolveModelScope) instead of hardcoding ollama/llama3.
      const settingsResult = await mod.getGlobalAiSettings();
      if (!settingsResult.success) {
        res.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
          "X-Accel-Buffering": "no",
        });
        res.write(`data: ${JSON.stringify({ type: "error", content: "Failed to load AI settings: " + (settingsResult.error || "unknown") })}\n\n`);
        res.end();
        return;
      }
      const allSettings = settingsResult.data as any;
      const providerPriority: string[] = ["openai", "anthropic", "google", "openrouter", "kilo", "ollama", "external"];
      let picked: { provider: string; model: string } | null = null;
      for (const p of providerPriority) {
        const cfg = allSettings.providers?.[p];
        if (!cfg || cfg.enabled === false) continue;
        if (p !== "ollama" && !cfg.apiKey?.trim()) continue;
        // Prefer the first model in the list (often the free one for kilo) over defaultModel
        const modelId = (cfg.models?.[0] || cfg.defaultModel || cfg.model || "").trim() || (p === "ollama" ? "llama3" : "");
        if (modelId) {
          picked = { provider: p, model: modelId };
          break;
        }
      }
      // Fallback to any provider with a key, else ollama
      if (!picked) {
        for (const [p, cfg] of Object.entries(allSettings.providers || {})) {
          const c = cfg as any;
          if (c?.enabled === false) continue;
          if (c?.apiKey?.trim() && (c.models?.[0] || c.defaultModel || c.model)) {
            picked = { provider: p, model: (c.models?.[0] || c.defaultModel || c.model).trim() };
            break;
          }
        }
      }
      if (!picked) {
        // No provider configured — surface a clear error instead of empty response
        res.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
          "X-Accel-Buffering": "no",
        });
        res.write(`data: ${JSON.stringify({ type: "error", content: "No AI provider is configured. Please add an API key in Settings → AI (OpenAI, Anthropic, etc.) and try again." })}\n\n`);
        res.write(`data: ${JSON.stringify({ type: "done" })}\n\n`);
        res.end();
        return;
      }

      const resolved = await resolveAiReq(
        {
          body: {
            provider: picked.provider,
            model: picked.model,
            prompt,
            connectionString,
            dbType,
            schemaContext: schemaTables,
          },
        } as any,
        res,
      );
      if (!resolved) return;

      // Use a mutable aborted flag so emitStep / isAborted see live value
      const abortState = { aborted: false };
      req.on("close", () => { abortState.aborted = true; });
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      });
      const permissionMode = resolvedAppMode.allowSqlWrite
        ? "schema_with_data"
        : resolvedAppMode.allowSqlRead
          ? "schema_with_data"
          : "schema_only";
      const modePrefixedPrompt = resolvedAppMode.promptRules
        ? `${resolvedAppMode.promptRules}\n\nUser request:\n${prompt}`
        : prompt;

      // Translate Pi's assistant_delta → harness text_delta so use-agent-harness renders it
      const piToHarnessEmit = (event: any) => {
        if (abortState.aborted) return;
        if (event.type === "assistant_delta" && event.message) {
          res.write(`data: ${JSON.stringify({ type: "text_delta", content: event.message })}\n\n`);
        } else if (event.type === "step" && event.message) {
          res.write(`data: ${JSON.stringify({ type: "tool_start", tool: "", input: { message: event.message }, label: event.message })}\n\n`);
        } else if (event.type === "tool_start") {
          let input: any = {};
          try { input = event.command ? JSON.parse(event.command) : {}; } catch {}
          res.write(`data: ${JSON.stringify({ type: "tool_start", tool: "", input, label: "", command: event.command })}\n\n`);
        } else if (event.type === "tool_output") {
          res.write(`data: ${JSON.stringify({ type: "tool_output", output: event.output || "", isError: !!event.isError })}\n\n`);
        } else if (event.type === "tool_end") {
          // no-op, harness will complete on tool_output
        } else if (event.type === "assistant_done" || event.type === "done") {
          // handled after streamPiResponse
        }
      };

      const piInput: PiAgentInput = {
        settings: resolved.settings,
        provider: resolved.provider,
        model: resolved.model,
        permissionMode,
        connectionString: resolved.connectionString,
        connectionId: resolved.connectionId ?? null,
        persistWorkflow: makePersistWorkflow(resolved.connectionId ?? null),
        dbType: resolved.dbType,
        selectedNamespace: resolved.namespace,
        schemaContext: schemaTables.length > 0 ? schemaTables : resolved.schemaContext,
        dashboardContext: [],
        workflowContext: { existing: [], current: null },
        workingDirectory: agentCwd,
        emitStep: (message: string) => {
          if (!abortState.aborted) {
            res.write(`data: ${JSON.stringify({ type: "tool_start", tool: "", input: { message }, label: message })}\n\n`);
          }
        },
      };

      const { session, dispose } = await createInfinityStudioPiSession(piInput);
      try {
        const fullText = await streamPiResponse({
          session,
          history: history || [],
          prompt: modePrefixedPrompt,
          emit: piToHarnessEmit,
          isAborted: () => abortState.aborted,
        });
        if (!abortState.aborted) {
          if (!fullText.trim()) {
            res.write(`data: ${JSON.stringify({ type: "error", content: "The assistant returned an empty response. Please try rephrasing your request or check that your AI provider is configured correctly." })}\n\n`);
            res.write(`data: ${JSON.stringify({ type: "done" })}\n\n`);
          } else {
            // fullText already streamed via text_delta, just signal completion
            res.write(`data: ${JSON.stringify({ type: "done", content: fullText })}\n\n`);
          }
        }
      } catch (err: any) {
        if (!abortState.aborted) {
          const msg = err?.message || String(err);
          // Surface Pi errors (including "model not found", empty, etc.) as harness errors
          res.write(`data: ${JSON.stringify({ type: "error", content: msg })}\n\n`);
          res.write(`data: ${JSON.stringify({ type: "done" })}\n\n`);
        }
      } finally {
        dispose();
      }
      res.end();
      return;
    }

    // External CLI harness
    const { getHarnessClient, spawnHarness } = await import("../lib/agents/harness-clients");
    const { buildAgentDatabaseContext } = await import("../lib/ai/system-prompt");
    const { buildStudioMcpServerConfig } = await import("../lib/agents/mcp/config");
    const client = getHarnessClient(provider);

    const mcp =
      typeof connectionString === "string" && connectionString
        ? buildStudioMcpServerConfig({
            connectionString,
            dbType: String(dbType || "unknown"),
            connectionName:
              typeof connectionName === "string" ? connectionName : undefined,
            appMode: resolvedAppMode,
          })
        : undefined;

    // Prefer app-mode → provider CLI mapping when the client didn't send a mode.
    const providerMode =
      (typeof mode === "string" && mode) ||
      resolvedAppMode.mapsToProviderMode?.[provider as keyof typeof resolvedAppMode.mapsToProviderMode] ||
      undefined;

    // Inject live connection + schema + app-mode rules into the prompt AND SCHEMA.md.
    const dbContext = buildAgentDatabaseContext({
      dbType: String(dbType || "unknown"),
      connectionName:
        typeof connectionName === "string" && connectionName
          ? connectionName
          : undefined,
      connectionId:
        connectionId !== undefined && connectionId !== null
          ? connectionId
          : undefined,
      selectedNamespace: undefined,
      schemaContext: schemaTables,
      // Absolute path — a bare filename left the model guessing (it tried
      // "/SCHEMA.md" at filesystem root and got "File not found").
      schemaFilePath: path.join(agentCwd, AGENT_SCHEMA_FILENAME),
    });
    const modeRules = resolvedAppMode.promptRules
      ? `\n\nAgent mode (${resolvedAppMode.label}):\n${resolvedAppMode.promptRules}`
      : "";
    const harnessPrompt = `${dbContext}${modeRules}\n\nUser request:\n${prompt}`;

    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });

    let aborted = false;
    let finished = false;
    let childProcess: any = null;
    const finish = () => {
      if (!finished) {
        finished = true;
        try { res.end(); } catch {}
      }
    };
    req.on("close", () => {
      aborted = true;
      try { childProcess?.kill("SIGTERM"); } catch {}
    });

    // Interactive harnesses (Cursor / Grok via ACP JSON-RPC over stdio)
    if (typeof (client as any).runPrompt === "function") {
      try {
        await (client as any).runPrompt({
          prompt: harnessPrompt,
          cwd: agentCwd,
          history,
          mode: providerMode,
          mcp,
          onEvent: (event: any) => {
            if (aborted || finished) return;
            res.write(`data: ${JSON.stringify(event)}\n\n`);
            if (event.type === "done") finish();
          },
          onSpawn: (proc: any) => {
            req.on("close", () => {
              try { proc.kill("SIGTERM"); } catch {}
            });
          },
        });
        if (!aborted) {
          res.write(`data: ${JSON.stringify({ type: "done" })}\n\n`);
        }
      } catch (err: any) {
        if (!aborted) {
          res.write(`data: ${JSON.stringify({ type: "error", content: err.message })}\n\n`);
        }
      } finally {
        finish();
      }
      return;
    }

    childProcess = spawnHarness(provider, {
      prompt: harnessPrompt,
      cwd: agentCwd,
      history,
      mode: providerMode,
      mcp,
    }).process;

    let buffer = "";

    childProcess.stdout?.on("data", (chunk: Buffer) => {
      if (aborted || finished) return;
      buffer += chunk.toString();
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (!line.trim()) continue;
        const events = client.parseLineAll
          ? client.parseLineAll(line)
          : (() => {
              const e = client.parseLine(line);
              return e ? [e] : [];
            })();
        for (const event of events) {
          res.write(`data: ${JSON.stringify(event)}\n\n`);
          if (event.type === "done") {
            finish();
            return;
          }
        }
      }
    });

    childProcess.stderr?.on("data", (chunk: Buffer) => {
      if (aborted) return;
      const text = chunk.toString().trim();
      if (text) {
        log(`[agents/${provider}] stderr:`, text.slice(0, 200));
      }
    });

    childProcess.on("close", (code: number | null) => {
      if (aborted) return;
      // Flush remaining buffer
      if (buffer.trim()) {
        const events = client.parseLineAll
          ? client.parseLineAll(buffer)
          : (() => {
              const e = client.parseLine(buffer);
              return e ? [e] : [];
            })();
        for (const event of events) {
          res.write(`data: ${JSON.stringify(event)}\n\n`);
          if (event.type === "done") {
            finish();
            return;
          }
        }
      }
      if (!aborted) {
        if (code !== 0) {
          res.write(
            `data: ${JSON.stringify({ type: "error", content: `Agent exited with code ${code}` })}\n\n`,
          );
        }
        res.write(`data: ${JSON.stringify({ type: "done", exitCode: code })}\n\n`);
        finish();
      }
    });

    childProcess.on("error", (err: Error) => {
      if (aborted || finished) return;
      log(`[agents/${provider}] spawn error:`, err.message);
      res.write(`data: ${JSON.stringify({ type: "error", content: err.message })}\n\n`);
      finish();
    });
  } catch (err: any) {
    log("[agents/chat/stream] error:", err.message);
    if (!res.headersSent) {
      res.status(500).json({ error: err.message });
    } else {
      res.write(`data: ${JSON.stringify({ type: "error", content: err.message })}\n\n`);
      res.end();
    }
  }
});

// The SPA catch-all goes last so every API route above wins; a no-op without INFSTUDIO_STATIC_DIR.
mountStatic(app, cfg);

// Listens on the configured bind; the port auto-increments only when neither bind nor port was pinned.
function startServer(port: number, maxPort: number = 3900) {
  const server = app.listen(port, cfg.bind, () => {
    log(`[infinity-studio-server] listening on ${cfg.bind}:${port}`);
    logToFile(`listening on ${cfg.bind}:${port}`);
    // Embed mode: the admin API (session minting and revocation) listens on its own loopback port; the key is never logged.
    startEmbedAdmin(cfg, embed)
      .then((address) => { if (address) log(`[infinity-studio-server] admin API listening on ${address}`); })
      .catch((err: Error) => { log(`[infinity-studio-server] failed to start the admin API: ${err.message}`); process.exit(1); });
    // Warm provider cache in background so first /api/agents/detect is instant (t3 pattern)
    setTimeout(() => {
      void refreshProvidersCacheInBackground().catch(() => {});
    }, 500);
    // Write port file for frontend discovery
    try {
      fs.writeFileSync(path.join(cfg.dataDir, "port.json"), JSON.stringify({ port }));
    } catch {}
    // Signal readiness to parent process
    if (process.send) {
      process.send({ type: "ready", port });
    }
  });
  server.on("error", (err: any) => {
    if (err.code === "EADDRINUSE" && !cfg.strictPort && port < maxPort) {
      const nextPort = port + 1;
      log(`[infinity-studio-server] port ${port} in use, trying ${nextPort}`);
      logToFile(`port ${port} in use, trying ${nextPort}`);
      startServer(nextPort, maxPort);
    } else {
      log(`[infinity-studio-server] failed to start on ${cfg.bind}:${port}: ${err.message}`);
      logToFile(`failed to start on ${cfg.bind}:${port}: ${err.message}`);
      process.exit(1);
    }
  });
}
startServer(PORT);
