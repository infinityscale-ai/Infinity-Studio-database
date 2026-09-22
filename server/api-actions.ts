// Explicit dispatch table for POST /api/actions/:action — one row per client callAction name.
import * as core from "../lib/db/actions-core";
import { applyPostgresSchemaToTarget, comparePostgresSchemas } from "../lib/db/actions";
import { createDatabase, createSchema } from "../lib/db/schema-introspection-actions";
import { createEnum, createIndex, createTrigger, deleteEnum, deleteIndex, toggleExtension } from "../lib/db/security-actions";
import { exportDatabaseBundle, importDatabaseBundle } from "../lib/db/export-helpers";

export type ActionFn = (...args: unknown[]) => Promise<unknown>;

// csArg/connIdArg: index of the connection string / connection id in the JSON args.
// write: the action mutates the target database. embed: allowed for a managed
// (embedded) connection — anything with a second connection or a bundle is denied.
export type ActionRule = {
  fn: ActionFn;
  csArg: number | null;
  connIdArg: number | null;
  write: boolean;
  embed: "allow" | "deny";
};

type RuleOptions = Omit<ActionRule, "fn">;
type Handler = (...args: never[]) => Promise<unknown>;

const READ: RuleOptions = { csArg: 0, connIdArg: null, write: false, embed: "allow" };
const WRITE: RuleOptions = { csArg: 0, connIdArg: null, write: true, embed: "allow" };
const SNAPSHOT: RuleOptions = { csArg: null, connIdArg: 0, write: false, embed: "allow" };
const TWO_CONNECTIONS_READ: RuleOptions = { csArg: 0, connIdArg: null, write: false, embed: "deny" };
const TWO_CONNECTIONS_WRITE: RuleOptions = { csArg: 0, connIdArg: null, write: true, embed: "deny" };
const BUNDLE_READ: RuleOptions = { csArg: 0, connIdArg: null, write: false, embed: "deny" };
const BUNDLE_WRITE: RuleOptions = { csArg: 0, connIdArg: null, write: true, embed: "deny" };

// Builds a rule, widening the handler's parameters to the untyped JSON args it receives.
function rule(fn: Handler, opts: RuleOptions): ActionRule {
  return { fn: fn as ActionFn, ...opts };
}

// Runs a bundle export with the server's own query runner.
function exportBundle(connectionString: string, format: "sql" | "json" | "csv") {
  return exportDatabaseBundle(connectionString, format, core.runQuery);
}

export const ACTIONS: Record<string, ActionRule> = {
  comparePostgresSchemas: rule(comparePostgresSchemas, TWO_CONNECTIONS_READ),
  applyPostgresSchemaToTarget: rule(applyPostgresSchemaToTarget, TWO_CONNECTIONS_WRITE),
  fetchRedisKeys: rule(core.fetchRedisKeys, READ),
  updateTableRows: rule(core.updateTableRows, WRITE),
  deleteTableRows: rule(core.deleteTableRows, WRITE),
  createSchema: rule(createSchema, WRITE),
  createDatabase: rule(createDatabase, WRITE),
  toggleExtension: rule(toggleExtension, WRITE),
  createEnum: rule(createEnum, WRITE),
  deleteEnum: rule(deleteEnum, WRITE),
  deleteIndex: rule(deleteIndex, WRITE),
  createIndex: rule(createIndex, WRITE),
  createTrigger: rule(createTrigger, WRITE),
  // The snapshot file persists the connection string it was taken with, so embed sessions may not create one.
  createSnapshot: rule(core.createSnapshot, { csArg: 0, connIdArg: 3, write: false, embed: "deny" }),
  listSnapshots: rule(core.listSnapshots, SNAPSHOT),
  getSnapshot: rule(core.getSnapshot, SNAPSHOT),
  getSnapshotFull: rule(core.getSnapshotFull, SNAPSHOT),
  deleteSnapshot: rule(core.deleteSnapshot, SNAPSHOT),
  compareSnapshots: rule(core.compareSnapshots, SNAPSHOT),
  exportDatabaseBundle: rule(exportBundle, BUNDLE_READ),
  importDatabaseBundle: rule(importDatabaseBundle, BUNDLE_WRITE),
};

// Finds the rule for an action name, ignoring inherited object keys.
export function lookupAction(name: string): ActionRule | undefined {
  return Object.hasOwn(ACTIONS, name) ? ACTIONS[name] : undefined;
}
