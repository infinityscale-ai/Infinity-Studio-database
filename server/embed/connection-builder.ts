import type { EmbedConnectionOptions, EmbedEngine } from "./sessions";

export type EmbedConnectionType = "postgres" | "mysql" | "mongodb" | "redis";

export type ManagedRowLike = {
  id: number;
  connectionType: string | null;
  host: string | null;
  port: string | null;
  database: string | null;
  username: string | null;
};

export type RedactedFields = "connectionString" | "password" | "authToken" | "host" | "username" | "port";

export type RedactedRow<T> = Omit<T, RedactedFields> & {
  connectionString: string;
  password: null;
  authToken: null;
  host: null;
  username: null;
  port: null;
};

export class EmbedEngineError extends Error {
  readonly code = "embed_engine_unsupported";
}

const ENGINE_ALIASES: Readonly<Record<string, EmbedEngine>> = {
  postgres: "postgres",
  postgresql: "postgres",
  mysql: "mysql",
  mariadb: "mysql",
  mongo: "mongo",
  mongodb: "mongo",
  redis: "redis",
};

const CONNECTION_TYPES: Readonly<Record<EmbedEngine, EmbedConnectionType>> = {
  postgres: "postgres",
  mysql: "mysql",
  mongo: "mongodb",
  redis: "redis",
};

const DEFAULT_PORTS: Readonly<Record<EmbedEngine, number>> = {
  postgres: 5432,
  mysql: 3306,
  mongo: 27017,
  redis: 6379,
};

// Parses a console engine name or a stored connection_type into a typed engine, or null.
export function parseEngine(value: unknown): EmbedEngine | null {
  if (typeof value !== "string") return null;
  return ENGINE_ALIASES[value.trim().toLowerCase()] ?? null;
}

// Maps a console engine name to the connection_type the studio drivers understand.
export function engineToConnectionType(engine: EmbedEngine): EmbedConnectionType {
  return CONNECTION_TYPES[engine];
}

// Returns the conventional port for an engine.
export function defaultPort(engine: EmbedEngine): number {
  return DEFAULT_PORTS[engine];
}

// Throws EmbedEngineError unless the connection type is one of the four embed engines; returns the engine.
export function assertEmbedEngine(connectionType: string | null | undefined): EmbedEngine {
  const engine = parseEngine(connectionType);
  if (!engine) throw new EmbedEngineError(`embed mode does not serve connection type "${connectionType ?? ""}"`);
  return engine;
}

// URL-encodes one connection string component.
function enc(value: string | null | undefined): string {
  return encodeURIComponent(value ?? "");
}

// Builds the driver connection string for a managed row from the in-memory secret; the result never persists.
export function buildConnectionString(row: ManagedRowLike, secret: string, options: EmbedConnectionOptions = {}): string {
  const engine = assertEmbedEngine(row.connectionType);
  const host = enc(row.host);
  const port = row.port && /^\d+$/.test(row.port) ? Number(row.port) : defaultPort(engine);
  const database = enc(row.database);
  const credentials = row.username ? `${enc(row.username)}:${enc(secret)}@` : "";
  switch (engine) {
    case "postgres":
      return `postgres://${credentials}${host}:${port}/${database}?sslmode=${enc(options.sslmode ?? "disable")}`;
    case "mysql":
      return `mysql://${credentials}${host}:${port}/${database}`;
    case "mongo":
      return `mongodb://${credentials}${host}:${port}/${database}?authSource=${enc(options.authSource ?? "admin")}`;
    case "redis":
      return `redis://${secret ? `:${enc(secret)}@` : ""}${host}:${port}/0`;
  }
}

// Strips connection details from a connections row before it reaches an embed client.
export function redactForClient<T extends { id: number }>(row: T): RedactedRow<T> {
  return {
    ...row,
    connectionString: `embed://${row.id}`,
    password: null,
    authToken: null,
    host: null,
    username: null,
    port: null,
  };
}
