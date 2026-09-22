import { isKnownAppThemeId, isKnownEditorThemeId, pairedEditorThemeId, type ThemeSelection } from "../../lib/studio/themes/theme-catalog";
import {
  DEFAULT_SESSION_TTL_SECONDS,
  DEFAULT_TOKEN_TTL_SECONDS,
  EMBED_ENGINES,
  MAX_SESSION_TTL_SECONDS,
  MAX_TOKEN_TTL_SECONDS,
  type EmbedConnectionOptions,
  type EmbedEngine,
} from "./sessions";

export type AdminSessionRequest = {
  externalId: string;
  userId: string;
  dbId: string;
  label: string;
  engine: EmbedEngine;
  host: string;
  port: number;
  username: string;
  password: string;
  database: string;
  options: EmbedConnectionOptions;
  ttlSeconds: number;
  tokenTtlSeconds: number;
  displayName: string;
  theme: ThemeSelection | null;
};

export type AdminValidationCode =
  | "invalid_body"
  | "read_only_unsupported"
  | "missing_field"
  | "field_too_long"
  | "invalid_field"
  | "invalid_external_id"
  | "invalid_engine"
  | "invalid_host"
  | "invalid_port"
  | "invalid_ttl"
  | "invalid_theme";

export type AdminParseFailure = { ok: false; code: AdminValidationCode; field?: string };
export type AdminParseResult = { ok: true; value: AdminSessionRequest } | AdminParseFailure;

export const EXTERNAL_ID_PATTERN = /^[A-Za-z0-9._:@-]+\/[A-Za-z0-9._:@-]+$/;
const MAX_EXTERNAL_ID_LENGTH = 128;
const MAX_FIELD_LENGTH = 512;
const MAX_OPTION_LENGTH = 64;
const SSL_MODES = new Set(["disable", "allow", "prefer", "require", "verify-ca", "verify-full"]);

const REQUIRED_STRINGS = ["externalId", "userId", "dbId", "label", "engine", "host", "database"] as const;
const OPTIONAL_STRINGS = ["username", "password", "displayName"] as const;
type StringField = (typeof REQUIRED_STRINGS)[number] | (typeof OPTIONAL_STRINGS)[number];
type StringFields = Record<StringField, string>;

// Reads one string field, tolerating absence only for optional ones and rejecting over-long values.
function readString(rec: Record<string, unknown>, field: StringField, required: boolean): string | AdminParseFailure {
  const raw = rec[field];
  if (raw === undefined || raw === null) return required ? { ok: false, code: "missing_field", field } : "";
  if (typeof raw !== "string") return { ok: false, code: "invalid_field", field };
  if (raw.length > MAX_FIELD_LENGTH) return { ok: false, code: "field_too_long", field };
  return raw;
}

// Reads every string field of the request, stopping at the first failure.
function readStrings(rec: Record<string, unknown>): StringFields | AdminParseFailure {
  const out: Partial<StringFields> = {};
  for (const field of REQUIRED_STRINGS) {
    const value = readString(rec, field, true);
    if (typeof value !== "string") return value;
    out[field] = value;
  }
  for (const field of OPTIONAL_STRINGS) {
    const value = readString(rec, field, false);
    if (typeof value !== "string") return value;
    out[field] = value;
  }
  return out as StringFields;
}

// Reads a port as an integer in 1..65535, or null.
function readPort(raw: unknown): number | null {
  const n = typeof raw === "string" ? Number(raw) : raw;
  return typeof n === "number" && Number.isInteger(n) && n >= 1 && n <= 65535 ? n : null;
}

// Reads a ttl in seconds within 1..max, using the default when absent; null when invalid.
function readTtl(raw: unknown, fallback: number, max: number): number | null {
  if (raw === undefined || raw === null) return fallback;
  return typeof raw === "number" && Number.isInteger(raw) && raw >= 1 && raw <= max ? raw : null;
}

// Reads the optional driver options object into a typed shape; null when malformed.
function readOptions(raw: unknown): EmbedConnectionOptions | null {
  if (raw === undefined || raw === null) return {};
  if (typeof raw !== "object" || Array.isArray(raw)) return null;
  const rec = raw as Record<string, unknown>;
  const out: EmbedConnectionOptions = {};
  if (rec.authSource !== undefined) {
    if (typeof rec.authSource !== "string" || rec.authSource.length > MAX_OPTION_LENGTH) return null;
    out.authSource = rec.authSource;
  }
  if (rec.sslmode !== undefined) {
    if (typeof rec.sslmode !== "string" || !SSL_MODES.has(rec.sslmode)) return null;
    out.sslmode = rec.sslmode;
  }
  return out;
}

// Reads the optional theme over the server default: an absent field keeps the default, an unknown app or editor id fails.
function readTheme(raw: unknown, fallback: ThemeSelection | null): ThemeSelection | null | AdminParseFailure {
  if (raw === undefined || raw === null) return fallback;
  if (typeof raw !== "object" || Array.isArray(raw)) return { ok: false, code: "invalid_theme", field: "theme" };
  const rec = raw as Record<string, unknown>;
  const app = rec.app ?? fallback?.app;
  if (typeof app !== "string" || !isKnownAppThemeId(app)) return { ok: false, code: "invalid_theme", field: "theme.app" };
  const inheritedEditor = rec.app === undefined ? fallback?.editor : undefined;
  const editor = rec.editor ?? inheritedEditor ?? pairedEditorThemeId(app);
  if (typeof editor !== "string" || !isKnownEditorThemeId(editor)) return { ok: false, code: "invalid_theme", field: "theme.editor" };
  return { app, editor };
}

// Checks the external id shape, its length, and that it is exactly `<userId>/<dbId>`.
function externalIdValid(fields: StringFields): boolean {
  return (
    fields.externalId.length <= MAX_EXTERNAL_ID_LENGTH &&
    EXTERNAL_ID_PATTERN.test(fields.externalId) &&
    fields.externalId === `${fields.userId}/${fields.dbId}`
  );
}

// Parses and validates an admin embed-session request body into a typed shape with a typed failure code.
export function parseAdminSessionRequest(body: unknown, defaultTheme: ThemeSelection | null = null): AdminParseResult {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return { ok: false, code: "invalid_body" };
  const rec = body as Record<string, unknown>;
  if (rec.readOnly === true) return { ok: false, code: "read_only_unsupported" };
  const fields = readStrings(rec);
  if ("ok" in fields) return fields;
  if (!externalIdValid(fields)) return { ok: false, code: "invalid_external_id" };
  const engine = EMBED_ENGINES.find((candidate) => candidate === fields.engine);
  if (!engine) return { ok: false, code: "invalid_engine" };
  if (fields.host.trim() === "") return { ok: false, code: "invalid_host" };
  const port = readPort(rec.port);
  if (port === null) return { ok: false, code: "invalid_port" };
  const ttlSeconds = readTtl(rec.ttlSeconds, DEFAULT_SESSION_TTL_SECONDS, MAX_SESSION_TTL_SECONDS);
  const tokenTtlSeconds = readTtl(rec.tokenTtlSeconds, DEFAULT_TOKEN_TTL_SECONDS, MAX_TOKEN_TTL_SECONDS);
  if (ttlSeconds === null || tokenTtlSeconds === null) return { ok: false, code: "invalid_ttl" };
  const options = readOptions(rec.options);
  if (options === null) return { ok: false, code: "invalid_field", field: "options" };
  const theme = readTheme(rec.theme, defaultTheme);
  if (theme !== null && "ok" in theme) return theme;
  const { externalId, userId, dbId, label, host, username, password, database } = fields;
  const displayName = fields.displayName || label;
  return {
    ok: true,
    value: { externalId, userId, dbId, label, engine, host, port, username, password, database, options, ttlSeconds, tokenTtlSeconds, displayName, theme },
  };
}
