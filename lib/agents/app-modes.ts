import type { AgentProviderId } from "./provider-types";

/**
 * Infinity Studio app-local agent modes — not global Claude/OpenCode roles.
 * These control SQL permissions, prompt rules, and optional CLI mode mapping.
 */
export type StudioAgentAppModeKind = "plan" | "build" | "custom";

export type StudioAgentAppMode = {
  id: string;
  label: string;
  kind: StudioAgentAppModeKind;
  description?: string;
  allowSqlRead: boolean;
  allowSqlWrite: boolean;
  /** Injected into harness + built-in agent prompts for this mode. */
  promptRules: string;
  /** Map to provider CLI flags when spawning (opencode --agent, claude --permission-mode, …). */
  mapsToProviderMode?: Partial<Record<AgentProviderId, string>>;
};

export const INFSTUDIO_PLAN_MODE: StudioAgentAppMode = {
  id: "infinity-studio-plan",
  label: "Plan",
  kind: "plan",
  description: "Inspect and propose changes; no mutating SQL",
  allowSqlRead: true,
  allowSqlWrite: false,
  promptRules: [
    "You are in Infinity Studio PLAN mode.",
    "You may inspect the live database with tools (list tables, schema, read-only queries).",
    "You must NOT execute INSERT/UPDATE/DELETE/DDL or any mutating SQL.",
    "When proposing schema changes, ALWAYS emit a fenced ```schema-plan block (language tag must be schema-plan, NOT json) so the UI can render a green/red table gateway.",
    "Exact shape:",
    '```schema-plan',
    '{',
    '  "title": "Short title",',
    '  "mode": "plan",',
    '  "tables": [',
    '    {',
    '      "schema": "public",',
    '      "table": "users",',
    '      "action": "alter",',
    '      "columns": [',
    '        { "name": "id", "type": "uuid", "change": "unchanged" },',
    '        { "name": "display_name", "type": "text", "change": "added" },',
    '        { "name": "legacy_flag", "type": "boolean", "change": "removed" }',
    '      ]',
    '    }',
    '  ],',
    '  "applySql": "ALTER TABLE ..."',
    '}',
    '```',
    "change must be one of: added | removed | unchanged | modified.",
    "Do not put the plan in a ```json fence — use ```schema-plan.",
    "Optional applySql is for later — do not run it in plan mode.",
  ].join("\n"),
  mapsToProviderMode: {
    opencode: "plan",
    "claude-code": "plan",
    codex: "read-only",
    "grok-build": "plan",
    fx: "default",
  },
};

export const INFSTUDIO_BUILD_MODE: StudioAgentAppMode = {
  id: "infinity-studio-build",
  label: "Build",
  kind: "build",
  description: "Inspect and run SQL against the connected database",
  allowSqlRead: true,
  allowSqlWrite: true,
  promptRules: [
    "You are in Infinity Studio BUILD mode.",
    "You may inspect the live database and run SQL (including writes) via tools when appropriate.",
    "Prefer confirming destructive DDL with the user before running it.",
    "For schema change proposals, still prefer a ```schema-plan block so the UI can show added/removed columns.",
  ].join("\n"),
  mapsToProviderMode: {
    opencode: "build",
    "claude-code": "acceptEdits",
    codex: "workspace-write",
    "grok-build": "default",
    fx: "auto",
  },
};

export const BUILTIN_APP_MODES: StudioAgentAppMode[] = [
  INFSTUDIO_PLAN_MODE,
  INFSTUDIO_BUILD_MODE,
];

const STORAGE_PREFIX = "infinity-agent-app-modes";
const SELECTION_PREFIX = "infinity-agent-app-mode";

function customKey(connectionId: number) {
  return `${STORAGE_PREFIX}-${connectionId}`;
}

function selectionKey(connectionId: number) {
  return `${SELECTION_PREFIX}-${connectionId}`;
}

export function loadCustomAppModes(connectionId: number): StudioAgentAppMode[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(customKey(connectionId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (m): m is StudioAgentAppMode =>
        m &&
        typeof m.id === "string" &&
        typeof m.label === "string" &&
        typeof m.promptRules === "string",
    );
  } catch {
    return [];
  }
}

export function saveCustomAppModes(
  connectionId: number,
  modes: StudioAgentAppMode[],
) {
  if (typeof window === "undefined") return;
  localStorage.setItem(customKey(connectionId), JSON.stringify(modes));
}

export function listAppModes(connectionId: number): StudioAgentAppMode[] {
  return [...BUILTIN_APP_MODES, ...loadCustomAppModes(connectionId)];
}

export function getAppMode(
  connectionId: number,
  modeId?: string | null,
): StudioAgentAppMode {
  const modes = listAppModes(connectionId);
  if (modeId) {
    const found = modes.find((m) => m.id === modeId);
    if (found) return found;
  }
  return INFSTUDIO_PLAN_MODE;
}

export function loadSelectedAppModeId(connectionId: number): string {
  if (typeof window === "undefined") return INFSTUDIO_PLAN_MODE.id;
  try {
    return localStorage.getItem(selectionKey(connectionId)) || INFSTUDIO_PLAN_MODE.id;
  } catch {
    return INFSTUDIO_PLAN_MODE.id;
  }
}

export function saveSelectedAppModeId(connectionId: number, modeId: string) {
  if (typeof window === "undefined") return;
  localStorage.setItem(selectionKey(connectionId), modeId);
}

export function resolveProviderModeForAppMode(
  appMode: StudioAgentAppMode,
  providerId: AgentProviderId,
): string | undefined {
  return appMode.mapsToProviderMode?.[providerId];
}
