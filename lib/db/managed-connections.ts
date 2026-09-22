import { and, eq, sql } from "drizzle-orm";
import {
  aiChats,
  connectionGroupMembers,
  connectionSettings,
  connections,
  dashboardState,
  folders,
  noteState,
  openTabs,
  queryHistory,
  snippets,
  tableTags,
  tags,
  workflows,
  type Connection,
} from "./schema";
import { ensureCoreTables } from "./ensure-core-tables";
import { runCoreTransaction } from "./sqlite-helpers";

export type ManagedConnectionInput = {
  externalId: string;
  label: string;
  connectionType: string;
  host: string;
  port: number;
  database: string;
  username: string;
};

export type ManagedConnectionFilter = { dbId: string } | { userId: string } | { externalId: string };

export type ManagedConnectionRepo = {
  findByExternalId(externalId: string): Promise<Connection | null>;
  findById(id: number): Promise<Connection | null>;
  find(filter: ManagedConnectionFilter): Promise<Connection[]>;
  upsert(input: ManagedConnectionInput): Promise<number>;
  purge(id: number): Promise<boolean>;
};

const FIND_LIMIT = 200;

// Placeholder kept in the NOT NULL connection_string column; the real string is built per request from the in-memory secret.
export function managedPlaceholder(externalId: string): string {
  return `embed://${externalId}`;
}

// Escapes LIKE wildcards so external-id fragments match literally.
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

// Builds the LIKE pattern selecting managed rows for a db, a user, or one external id.
function filterPattern(filter: ManagedConnectionFilter): string {
  if ("dbId" in filter) return `%/${escapeLike(filter.dbId)}`;
  if ("userId" in filter) return `${escapeLike(filter.userId)}/%`;
  return escapeLike(filter.externalId);
}

// Returns the managed connection row for a console-side external id, or null.
export async function getManagedByExternalId(externalId: string): Promise<Connection | null> {
  const rows = await findManagedConnections({ externalId });
  return rows[0] ?? null;
}

// Returns a managed connection row by id, or null when missing or not managed.
export async function getManagedConnection(id: number): Promise<Connection | null> {
  const { db } = await import("./index");
  await ensureCoreTables();
  const rows = await db
    .select()
    .from(connections)
    .where(and(eq(connections.id, id), eq(connections.managed, 1)))
    .limit(1);
  return rows[0] ?? null;
}

// Lists managed rows whose external id matches one database, one user, or exactly one id.
export async function findManagedConnections(filter: ManagedConnectionFilter): Promise<Connection[]> {
  const { db } = await import("./index");
  await ensureCoreTables();
  const pattern = filterPattern(filter);
  return db
    .select()
    .from(connections)
    .where(and(eq(connections.managed, 1), sql`${connections.externalId} LIKE ${pattern} ESCAPE '\\'`))
    .orderBy(connections.id)
    .limit(FIND_LIMIT);
}

// Creates or refreshes the managed row for an external id and returns its connection id; no password is written.
export async function upsertManagedConnection(input: ManagedConnectionInput): Promise<number> {
  await ensureCoreTables();
  return runCoreTransaction("upsertManagedConnection", async (db) => {
    const fields = {
      name: input.label,
      connectionType: input.connectionType,
      host: input.host,
      port: String(input.port),
      database: input.database,
      username: input.username,
      password: null,
      authToken: null,
      connectionString: managedPlaceholder(input.externalId),
      managed: 1,
    };
    const existing = await db
      .select({ id: connections.id })
      .from(connections)
      .where(eq(connections.externalId, input.externalId))
      .limit(1);
    if (existing[0]) {
      await db.update(connections).set(fields).where(eq(connections.id, existing[0].id));
      return existing[0].id;
    }
    const inserted = await db
      .insert(connections)
      .values({ ...fields, externalId: input.externalId, createdAt: new Date(), sortOrder: Date.now() })
      .returning({ id: connections.id });
    return inserted[0].id;
  });
}

// Deletes every per-connection studio table row for one connection id inside the caller's transaction.
async function deleteConnectionState(db: typeof import("./index").db, id: number): Promise<void> {
  await db.delete(snippets).where(eq(snippets.connectionId, id));
  await db.delete(folders).where(eq(folders.connectionId, id));
  await db.delete(queryHistory).where(eq(queryHistory.connectionId, id));
  await db.delete(tags).where(eq(tags.connectionId, id));
  await db.delete(tableTags).where(eq(tableTags.connectionId, id));
  await db.delete(openTabs).where(eq(openTabs.connectionId, id));
  await db.delete(connectionSettings).where(eq(connectionSettings.connectionId, id));
  await db.delete(dashboardState).where(eq(dashboardState.connectionId, id));
  await db.delete(noteState).where(eq(noteState.connectionId, id));
  await db.delete(workflows).where(eq(workflows.connectionId, id));
  await db.delete(aiChats).where(eq(aiChats.connectionId, id));
  await db.delete(connectionGroupMembers).where(eq(connectionGroupMembers.connectionId, id));
}

// Removes a managed row together with all of its studio state; reports whether a row existed.
export async function purgeManagedConnection(id: number): Promise<boolean> {
  await ensureCoreTables();
  return runCoreTransaction("purgeManagedConnection", async (db) => {
    const existing = await db
      .select({ id: connections.id })
      .from(connections)
      .where(and(eq(connections.id, id), eq(connections.managed, 1)))
      .limit(1);
    if (!existing[0]) return false;
    await deleteConnectionState(db, id);
    await db.delete(connections).where(eq(connections.id, id));
    return true;
  });
}

// Repository adapter over this module, injected into the embed admin routes.
export const managedConnectionRepo: ManagedConnectionRepo = Object.freeze({
  findByExternalId: getManagedByExternalId,
  findById: getManagedConnection,
  find: findManagedConnections,
  upsert: upsertManagedConnection,
  purge: purgeManagedConnection,
});
