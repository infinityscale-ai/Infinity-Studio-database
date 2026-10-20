import { detectConnectionDbType } from "../db/connection-type";
import { usesDatabaseNamespaces } from "../db/namespace-display";
import { getDatabaseFromConnectionString } from "./db-utils";

/** Schemas the server keeps for itself; opening on one shows "No tables" for a database that has plenty. */
const SYSTEM_SCHEMAS = new Set(["information_schema", "performance_schema", "mysql", "sys", "pg_catalog", "pg_toast"]);

// defaultSchemaFor picks the schema a connection opens on: its own database, then public or dbo, then the first that is not a system schema.
export function defaultSchemaFor(connectionString: string, schemas: string[]): string | null {
  if (schemas.length === 0) return null;
  const type = detectConnectionDbType(connectionString);
  if (usesDatabaseNamespaces(type)) {
    const own = getDatabaseFromConnectionString(connectionString);
    if (own && schemas.includes(own) && !SYSTEM_SCHEMAS.has(own.toLowerCase())) return own;
  }
  if (type === "mssql" && schemas.includes("dbo")) return "dbo";
  if (schemas.includes("public")) return "public";
  return schemas.find((s) => !SYSTEM_SCHEMAS.has(s.toLowerCase())) ?? schemas[0];
}
