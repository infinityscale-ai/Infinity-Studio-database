// Typed server configuration read from INFSTUDIO_* environment variables.
import { isKnownAppThemeId, isKnownEditorThemeId, pairedEditorThemeId, type ThemeSelection } from "../../lib/studio/themes/theme-catalog";

export type AdminConfig = { port: number; bind: string; key: string };

export type ServerConfig = {
  port: number;
  bind: string;
  strictPort: boolean;
  staticDir: string | null;
  dataDir: string;
  apiKey: string;
  allowUnauthenticated: boolean;
  corsOrigins: string[];
  embedMode: boolean;
  embedAllowedOrigins: string[];
  consoleOrigin: string | null;
  embedTheme: ThemeSelection | null;
  admin: AdminConfig | null;
  mcpDisabled: boolean;
};

export type ConfigProblem = { key: string; message: string };

type Env = Record<string, string | undefined>;

const DEFAULT_PORT = 3867;
const DEFAULT_BIND = "127.0.0.1";
const MIN_ADMIN_KEY_LENGTH = 32;

// Splits a comma-separated env value into trimmed, non-empty entries.
function splitList(value: string | undefined): string[] {
  if (!value) return [];
  return value.split(",").map((s) => s.trim()).filter(Boolean);
}

// Reads a boolean env flag; "1", "true" and "yes" switch it on.
function flag(value: string | undefined): boolean {
  if (!value) return false;
  return ["1", "true", "yes"].includes(value.trim().toLowerCase());
}

// Parses a TCP port, falling back when the value is missing or out of range.
function parsePort(value: string | undefined, fallback: number): number {
  const n = Number.parseInt(value ?? "", 10);
  return Number.isInteger(n) && n > 0 && n < 65536 ? n : fallback;
}

// Reports whether a bind address only accepts connections from this host.
export function isLoopback(bind: string): boolean {
  const host = bind.trim().toLowerCase();
  return host === "localhost" || host === "::1" || host.startsWith("127.");
}

// Reads the optional admin listener; present as soon as INFSTUDIO_ADMIN_PORT is set.
function readAdmin(env: Env): AdminConfig | null {
  if (!env.INFSTUDIO_ADMIN_PORT) return null;
  return {
    port: parsePort(env.INFSTUDIO_ADMIN_PORT, 0),
    bind: env.INFSTUDIO_ADMIN_BIND?.trim() || DEFAULT_BIND,
    key: env.INFSTUDIO_ADMIN_KEY?.trim() || "",
  };
}

// Reads the look every embedded session gets unless the console overrides it; the editor theme defaults to the app theme's pair.
function readEmbedTheme(env: Env): ThemeSelection | null {
  const app = env.INFSTUDIO_EMBED_THEME?.trim();
  if (!app) return null;
  return { app, editor: env.INFSTUDIO_EMBED_EDITOR_THEME?.trim() || pairedEditorThemeId(app) };
}

// Lists the embed theme ids this build does not know.
function embedThemeProblems(theme: ThemeSelection | null): ConfigProblem[] {
  if (!theme) return [];
  const problems: ConfigProblem[] = [];
  if (!isKnownAppThemeId(theme.app)) {
    problems.push({ key: "INFSTUDIO_EMBED_THEME", message: `INFSTUDIO_EMBED_THEME names an unknown app theme "${theme.app}"` });
  }
  if (!isKnownEditorThemeId(theme.editor)) {
    problems.push({ key: "INFSTUDIO_EMBED_EDITOR_THEME", message: `INFSTUDIO_EMBED_EDITOR_THEME names an unknown editor theme "${theme.editor}"` });
  }
  return problems;
}

// Reads the server configuration; explicit bind or port pins the port (no auto-increment).
export function readServerConfig(env: Env = process.env): ServerConfig {
  return {
    port: parsePort(env.INFSTUDIO_SERVER_PORT, DEFAULT_PORT),
    bind: env.INFSTUDIO_BIND?.trim() || DEFAULT_BIND,
    strictPort: Boolean(env.INFSTUDIO_BIND || env.INFSTUDIO_SERVER_PORT),
    staticDir: env.INFSTUDIO_STATIC_DIR?.trim() || null,
    dataDir: env.INFSTUDIO_USER_DATA_DIR?.trim() || process.cwd(),
    apiKey: env.INFSTUDIO_API_KEY?.trim() || "",
    allowUnauthenticated: flag(env.INFSTUDIO_ALLOW_UNAUTHENTICATED),
    corsOrigins: splitList(env.INFSTUDIO_CORS_ORIGINS),
    embedMode: flag(env.INFSTUDIO_EMBED_MODE),
    embedAllowedOrigins: splitList(env.INFSTUDIO_EMBED_ALLOWED_ORIGINS),
    consoleOrigin: env.INFSTUDIO_CONSOLE_ORIGIN?.trim() || null,
    embedTheme: readEmbedTheme(env),
    admin: readAdmin(env),
    mcpDisabled: flag(env.INFSTUDIO_MCP_DISABLED),
  };
}

// Lists the fatal configuration problems; an empty list means the server may start.
export function validateServerConfig(cfg: ServerConfig): ConfigProblem[] {
  const problems: ConfigProblem[] = [];
  const exposed = !isLoopback(cfg.bind);
  if (exposed && !cfg.apiKey && !cfg.allowUnauthenticated && !cfg.embedMode) {
    problems.push({
      key: "INFSTUDIO_API_KEY",
      message: `refusing to bind ${cfg.bind} without INFSTUDIO_API_KEY (set it, or INFSTUDIO_ALLOW_UNAUTHENTICATED=1 behind a trusted proxy)`,
    });
  }
  if (cfg.admin && cfg.admin.port === 0) {
    problems.push({ key: "INFSTUDIO_ADMIN_PORT", message: "INFSTUDIO_ADMIN_PORT is not a valid port" });
  }
  if (cfg.admin && cfg.admin.key.length < MIN_ADMIN_KEY_LENGTH) {
    problems.push({
      key: "INFSTUDIO_ADMIN_KEY",
      message: `INFSTUDIO_ADMIN_KEY must be at least ${MIN_ADMIN_KEY_LENGTH} characters`,
    });
  }
  if (cfg.embedMode && !cfg.admin) {
    problems.push({
      key: "INFSTUDIO_EMBED_MODE",
      message: "INFSTUDIO_EMBED_MODE=1 requires the admin listener (INFSTUDIO_ADMIN_PORT and INFSTUDIO_ADMIN_KEY)",
    });
  }
  problems.push(...embedThemeProblems(cfg.embedTheme));
  return problems;
}
