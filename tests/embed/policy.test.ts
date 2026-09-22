import { describe, expect, test } from "bun:test";
import {
  classifyStatement,
  decideEmbedRequest,
  isAuthError,
  type EmbedActionTable,
  type EmbedDeny,
  type EmbedPolicyInput,
} from "../../server/embed/policy";

const CS = "postgres://app:secret@db.internal:5432/orders?sslmode=disable";
const actions: EmbedActionTable = {
  fetchSchemas: { csArg: 0, connIdArg: null, write: false, embed: "allow" },
  saveThing: { csArg: 1, connIdArg: 0, write: true, embed: "allow" },
  runDbBackup: { csArg: 0, connIdArg: null, write: true, embed: "deny" },
};

// Builds a policy input for session connection 7.
function input(over: Partial<EmbedPolicyInput>): EmbedPolicyInput {
  return { method: "POST", path: "/", body: {}, session: { connectionId: 7 }, actions, connectionString: CS, ...over };
}

const DENIED: EmbedDeny = { allow: false, status: 403, error: "embed_forbidden" };

describe("decideEmbedRequest", () => {
  test.each([
    ["POST", "/api/sql/run"],
    ["POST", "/api/sql/cancel"],
    ["POST", "/api/schema"],
    ["POST", "/api/tables"],
    ["POST", "/api/tables-with-columns"],
    ["POST", "/api/tables/search-all"],
    ["POST", "/api/table-structure"],
    ["POST", "/api/table-foreign-keys"],
    ["POST", "/api/referenced-record"],
    ["POST", "/api/functions"],
    ["POST", "/api/views"],
    ["POST", "/api/indexes"],
    ["POST", "/api/triggers"],
    ["POST", "/api/enums"],
    ["POST", "/api/extensions"],
    ["POST", "/api/table/update-rows"],
    ["POST", "/api/table/delete-rows"],
    ["POST", "/api/rls-policies"],
    ["POST", "/api/postgres-roles"],
    ["POST", "/api/table-security-info"],
    ["POST", "/api/sessions"],
    ["POST", "/api/locks"],
    ["POST", "/api/explain-plan"],
  ])("%s %s is allowed with the body connection string replaced", (method, path) => {
    const decision = decideEmbedRequest(input({ method, path, body: { connectionString: "embed://7", query: "SELECT 1" } }));
    expect(decision).toEqual({ allow: true, rewriteBody: { connectionString: CS, query: "SELECT 1" } });
  });

  test.each([
    ["GET", "/api/connections"],
    ["POST", "/api/connections"],
    ["GET", "/api/connections/7"],
    ["DELETE", "/api/connections/7"],
    ["POST", "/api/connections/test"],
    ["POST", "/api/databases"],
    ["POST", "/api/sessions/kill"],
    ["POST", "/api/sessions/cancel-query"],
    ["POST", "/api/backup/run"],
    ["POST", "/api/snapshots/create-stream"],
    ["POST", "/api/settings/migrate"],
    ["GET", "/api/mcp/config"],
    ["POST", "/mcp"],
    ["GET", "/api/agents"],
    ["POST", "/api/agents/chat/stream"],
    ["GET", "/api/ai/chats"],
    ["GET", "/api/workflows"],
    ["POST", "/api/app-font"],
    ["POST", "/api/app-theme"],
    ["POST", "/api/editor-theme"],
    ["POST", "/api/studio-settings"],
    ["POST", "/api/keybindings"],
    ["POST", "/api/db-advisor"],
    ["POST", "/api/supabase-auth-users"],
    ["GET", "/api/sql/run"],
    ["POST", "/health"],
    ["POST", "/api/embed/claim"],
    ["GET", "/studio/7/bootstrap/extra"],
    ["PUT", "/studio/7/tabs"],
  ])("%s %s is forbidden", (method, path) => {
    expect(decideEmbedRequest(input({ method, path }))).toEqual(DENIED);
  });

  test.each([
    ["GET", "/api/app-font"],
    ["GET", "/api/app-theme"],
    ["GET", "/api/editor-theme"],
    ["GET", "/api/studio-settings"],
    ["GET", "/api/keybindings"],
    ["GET", "/api/embed/session"],
    ["GET", "/health"],
  ])("%s %s is allowed untouched", (method, path) => {
    expect(decideEmbedRequest(input({ method, path }))).toEqual({ allow: true });
  });

  test.each([
    ["GET", "/studio/7/folders"],
    ["POST", "/studio/7/folders"],
    ["GET", "/studio/7/snippets"],
    ["POST", "/studio/7/history"],
    ["POST", "/studio/7/history/entry"],
    ["DELETE", "/studio/7/history"],
    ["GET", "/studio/7/tags"],
    ["POST", "/studio/7/table-tags"],
    ["GET", "/studio/7/tabs"],
    ["POST", "/studio/7/settings"],
    ["GET", "/studio/7/dashboards"],
    ["POST", "/studio/7/notes"],
    ["GET", "/studio/7/bootstrap"],
    ["GET", "/studio/7/tabs/"],
  ])("%s %s is allowed for the session's own connection", (method, path) => {
    expect(decideEmbedRequest(input({ method, path }))).toEqual({ allow: true, rewriteParams: { connectionId: "7" } });
  });

  test("studio routes for another connection id are forbidden", () => {
    expect(decideEmbedRequest(input({ method: "GET", path: "/studio/8/bootstrap" }))).toEqual(DENIED);
    expect(decideEmbedRequest(input({ method: "POST", path: "/studio/07/tabs" }))).toEqual(DENIED);
    expect(decideEmbedRequest(input({ method: "DELETE", path: "/studio/8/history" }))).toEqual(DENIED);
  });

  test("actions rewrite csArg and pin connIdArg", () => {
    expect(decideEmbedRequest(input({ path: "/api/actions/fetchSchemas", body: { args: ["embed://7", "public"] } }))).toEqual({
      allow: true,
      rewriteBody: { args: [CS, "public"] },
    });
    expect(decideEmbedRequest(input({ path: "/api/actions/saveThing", body: { args: [7, "embed://7", { x: 1 }] } }))).toEqual({
      allow: true,
      rewriteBody: { args: [7, CS, { x: 1 }] },
    });
    expect(decideEmbedRequest(input({ path: "/api/actions/saveThing", body: { args: ["7", "x"] } }))).toEqual({
      allow: true,
      rewriteBody: { args: ["7", CS] },
    });
  });

  test("actions marked deny, unknown, or pointing at another connection are forbidden", () => {
    expect(decideEmbedRequest(input({ path: "/api/actions/runDbBackup", body: { args: ["x"] } }))).toEqual(DENIED);
    expect(decideEmbedRequest(input({ path: "/api/actions/nope", body: { args: [] } }))).toEqual(DENIED);
    expect(decideEmbedRequest(input({ path: "/api/actions/toString", body: { args: [] } }))).toEqual(DENIED);
    expect(decideEmbedRequest(input({ path: "/api/actions/saveThing", body: { args: [8, "embed://8"] } }))).toEqual(DENIED);
    expect(decideEmbedRequest(input({ path: "/api/actions/saveThing", body: {} }))).toEqual(DENIED);
  });
});

describe("classifyStatement", () => {
  test("returns the first keyword uppercased, ignoring comments", () => {
    expect(classifyStatement("select * from t")).toBe("SELECT");
    expect(classifyStatement("  -- note\n/* block */ Update t set a=1")).toBe("UPDATE");
    expect(classifyStatement("WITH x AS (select 1) select * from x")).toBe("WITH");
    expect(classifyStatement("")).toBeNull();
    expect(classifyStatement(42)).toBeNull();
  });
});

describe("isAuthError", () => {
  test("recognises each engine's auth failure by code or message", () => {
    expect(isAuthError({ code: "28P01", message: "x" }, "postgres")).toBe(true);
    expect(isAuthError('password authentication failed for user "app"', "postgres")).toBe(true);
    expect(isAuthError({ code: "ER_ACCESS_DENIED_ERROR", errno: 1045 }, "mysql")).toBe(true);
    expect(isAuthError({ errno: 1045 }, "mysql")).toBe(true);
    expect(isAuthError({ code: 18, codeName: "AuthenticationFailed" }, "mongo")).toBe(true);
    expect(isAuthError("MongoServerError: Authentication failed.", "mongo")).toBe(true);
    expect(isAuthError(new Error("WRONGPASS invalid username-password pair"), "redis")).toBe(true);
    expect(isAuthError("NOAUTH Authentication required.", "redis")).toBe(true);
  });

  test("does not match ordinary errors or another engine's codes", () => {
    expect(isAuthError({ code: "42P01", message: 'relation "x" does not exist' }, "postgres")).toBe(false);
    expect(isAuthError("WRONGPASS", "postgres")).toBe(false);
    expect(isAuthError(null, "redis")).toBe(false);
    expect(isAuthError(undefined, "mysql")).toBe(false);
  });
});
