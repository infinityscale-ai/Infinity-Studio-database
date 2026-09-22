import type { EmbedEngine } from "./sessions";

export type EmbedActionRule = {
  csArg: number | null;
  connIdArg: number | null;
  write: boolean;
  embed: "allow" | "deny";
};
export type EmbedActionTable = Readonly<Record<string, EmbedActionRule>>;

export type EmbedPolicyInput = {
  method: string;
  path: string;
  params?: Readonly<Record<string, string>>;
  body?: unknown;
  session: { connectionId: number };
  actions: EmbedActionTable;
  connectionString: string;
};

export type EmbedAllow = {
  allow: true;
  rewriteBody?: Record<string, unknown>;
  rewriteParams?: { connectionId: string };
};
export type EmbedDeny = { allow: false; status: 403; error: "embed_forbidden" };
export type EmbedDecision = EmbedAllow | EmbedDeny;

type RuleKind = "connection-body" | "studio" | "action" | "plain";
type Rule = { methods: readonly string[]; pattern: RegExp; kind: RuleKind };

const DENY: EmbedDeny = { allow: false, status: 403, error: "embed_forbidden" };

const CONNECTION_BODY_PATHS = [
  "sql/run", "sql/cancel", "schema", "tables", "tables-with-columns", "tables/search-all",
  "table-structure", "table-foreign-keys", "referenced-record", "functions", "views", "indexes",
  "triggers", "enums", "extensions", "table/update-rows", "table/delete-rows", "rls-policies",
  "postgres-roles", "table-security-info", "sessions", "locks", "explain-plan",
] as const;

const STUDIO_RESOURCES = [
  "folders", "snippets", "history", "history/entry", "tags", "table-tags", "tabs", "settings", "dashboards", "notes",
] as const;

const PLAIN_GET_PATHS = ["app-font", "app-theme", "editor-theme", "studio-settings", "keybindings", "embed/session"] as const;

// Escapes a literal path fragment for use inside a RegExp alternation.
function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
}

// Builds an anchored pattern matching `/<prefix>/<one of the fragments>`.
function anyOf(prefix: string, fragments: readonly string[]): RegExp {
  return new RegExp(`^${escapeRegex(prefix)}(?:${fragments.map(escapeRegex).join("|")})$`);
}

const RULES: readonly Rule[] = [
  { methods: ["POST"], pattern: anyOf("/api/", CONNECTION_BODY_PATHS), kind: "connection-body" },
  { methods: ["POST"], pattern: /^\/api\/actions\/([A-Za-z0-9_]+)$/, kind: "action" },
  { methods: ["GET", "POST"], pattern: new RegExp(`^/studio/([^/]+)/(?:${STUDIO_RESOURCES.map(escapeRegex).join("|")})$`), kind: "studio" },
  { methods: ["DELETE"], pattern: /^\/studio\/([^/]+)\/history$/, kind: "studio" },
  { methods: ["GET"], pattern: /^\/studio\/([^/]+)\/bootstrap$/, kind: "studio" },
  { methods: ["GET"], pattern: anyOf("/api/", PLAIN_GET_PATHS), kind: "plain" },
  { methods: ["GET"], pattern: /^\/health$/, kind: "plain" },
];

// Returns the value as a string-keyed record, or an empty record for anything else.
export function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

// Allows a studio route only when its connection id is the session's own.
function decideStudio(id: string, connectionId: number): EmbedDecision {
  return id === String(connectionId) ? { allow: true, rewriteParams: { connectionId: id } } : DENY;
}

// Allows an action marked embed:"allow", pinning its connection arguments to the session.
function decideAction(name: string, input: EmbedPolicyInput): EmbedDecision {
  const rule = Object.prototype.hasOwnProperty.call(input.actions, name) ? input.actions[name] : undefined;
  if (!rule || rule.embed !== "allow") return DENY;
  const body = asRecord(input.body);
  const args: unknown[] = Array.isArray(body.args) ? [...body.args] : [];
  if (rule.connIdArg !== null && Number(args[rule.connIdArg]) !== input.session.connectionId) return DENY;
  if (rule.csArg !== null) args[rule.csArg] = input.connectionString;
  return { allow: true, rewriteBody: { ...body, args } };
}

// Applies the rewrite a matched rule prescribes.
function applyRule(rule: Rule, match: RegExpExecArray, input: EmbedPolicyInput): EmbedDecision {
  switch (rule.kind) {
    case "plain":
      return { allow: true };
    case "connection-body":
      return { allow: true, rewriteBody: { ...asRecord(input.body), connectionString: input.connectionString } };
    case "studio":
      return decideStudio(match[1], input.session.connectionId);
    case "action":
      return decideAction(match[1], input);
  }
}

// Decides whether an embed-authenticated request may proceed and how its body must be rewritten; default deny.
export function decideEmbedRequest(input: EmbedPolicyInput): EmbedDecision {
  const method = input.method.toUpperCase();
  const path = input.path.length > 1 && input.path.endsWith("/") ? input.path.slice(0, -1) : input.path;
  for (const rule of RULES) {
    if (!rule.methods.includes(method)) continue;
    const match = rule.pattern.exec(path);
    if (match) return applyRule(rule, match, input);
  }
  return DENY;
}

// Returns the first SQL keyword uppercased for the audit line, ignoring leading comments; null when absent.
export function classifyStatement(sql: unknown): string | null {
  if (typeof sql !== "string") return null;
  const stripped = sql.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--[^\n]*/g, " ").trim();
  const match = /^([A-Za-z_]+)/.exec(stripped);
  return match ? match[1].toUpperCase() : null;
}

type AuthSignature = { codes: ReadonlySet<string>; messages: readonly RegExp[] };

const AUTH_SIGNATURES: Readonly<Record<EmbedEngine, AuthSignature>> = {
  postgres: { codes: new Set(["28P01", "28000"]), messages: [/password authentication failed/i, /\b28P01\b/, /\b28000\b/] },
  mysql: { codes: new Set(["ER_ACCESS_DENIED_ERROR", "1045"]), messages: [/access denied for user/i, /ER_ACCESS_DENIED_ERROR/] },
  mongo: { codes: new Set(["18", "AuthenticationFailed"]), messages: [/authentication failed/i] },
  redis: { codes: new Set(["WRONGPASS", "NOAUTH"]), messages: [/\bWRONGPASS\b/, /\bNOAUTH\b/] },
};

// Extracts a string code and message from an unknown thrown value or error message.
function describeError(err: unknown): { code: string | null; message: string } {
  if (typeof err === "string") return { code: null, message: err };
  if (typeof err !== "object" || err === null) return { code: null, message: "" };
  const rec = err as Record<string, unknown>;
  const raw = rec.code ?? rec.errno ?? rec.codeName;
  const code = typeof raw === "string" || typeof raw === "number" ? String(raw) : null;
  return { code, message: typeof rec.message === "string" ? rec.message : "" };
}

// Reports whether a driver error (or its message) is an authentication failure for the given engine.
export function isAuthError(err: unknown, engine: EmbedEngine): boolean {
  const signature = AUTH_SIGNATURES[engine];
  const { code, message } = describeError(err);
  if (code !== null && signature.codes.has(code)) return true;
  return signature.messages.some((pattern) => pattern.test(message));
}
