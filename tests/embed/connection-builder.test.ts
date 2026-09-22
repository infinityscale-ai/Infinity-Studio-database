import { describe, expect, test } from "bun:test";
import {
  assertEmbedEngine,
  buildConnectionString,
  defaultPort,
  EmbedEngineError,
  engineToConnectionType,
  parseEngine,
  redactForClient,
  type ManagedRowLike,
} from "../../server/embed/connection-builder";

// Builds a managed row for the given connection type.
function row(connectionType: string, over: Partial<ManagedRowLike> = {}): ManagedRowLike {
  return { id: 7, connectionType, host: "db.internal", port: "5432", database: "orders", username: "app", ...over };
}

describe("buildConnectionString", () => {
  test("postgres defaults sslmode to disable and honours an explicit one", () => {
    expect(buildConnectionString(row("postgres"), "secret")).toBe("postgres://app:secret@db.internal:5432/orders?sslmode=disable");
    expect(buildConnectionString(row("postgres"), "secret", { sslmode: "require" })).toBe(
      "postgres://app:secret@db.internal:5432/orders?sslmode=require",
    );
  });

  test("mysql", () => {
    expect(buildConnectionString(row("mysql", { port: "3306" }), "secret")).toBe("mysql://app:secret@db.internal:3306/orders");
  });

  test("mongo defaults authSource to admin and omits credentials without a username", () => {
    expect(buildConnectionString(row("mongodb", { port: "27017" }), "secret")).toBe(
      "mongodb://app:secret@db.internal:27017/orders?authSource=admin",
    );
    expect(buildConnectionString(row("mongodb", { port: "27017" }), "secret", { authSource: "orders" })).toBe(
      "mongodb://app:secret@db.internal:27017/orders?authSource=orders",
    );
    expect(buildConnectionString(row("mongodb", { port: "27017", username: "" }), "secret")).toBe(
      "mongodb://db.internal:27017/orders?authSource=admin",
    );
  });

  test("redis carries only the password and always selects db 0", () => {
    expect(buildConnectionString(row("redis", { port: "6379", username: "default" }), "secret")).toBe("redis://:secret@db.internal:6379/0");
    expect(buildConnectionString(row("redis", { port: "6379" }), "")).toBe("redis://db.internal:6379/0");
  });

  test("URL-encodes every component", () => {
    const built = buildConnectionString(row("postgres", { username: "us er", database: "o/r" }), "p@ss:w/rd");
    expect(built).toBe("postgres://us%20er:p%40ss%3Aw%2Frd@db.internal:5432/o%2Fr?sslmode=disable");
    expect(new URL(built).password).toBe("p%40ss%3Aw%2Frd");
    expect(decodeURIComponent(new URL(built).password)).toBe("p@ss:w/rd");
  });

  test("falls back to the engine's default port when the row has none", () => {
    expect(buildConnectionString(row("mysql", { port: null }), "s")).toBe("mysql://app:s@db.internal:3306/orders");
    expect(buildConnectionString(row("redis", { port: "abc" }), "s")).toBe("redis://:s@db.internal:6379/0");
  });

  test("refuses connection types outside the four engines", () => {
    expect(() => buildConnectionString(row("sqlite"), "s")).toThrow(EmbedEngineError);
    expect(() => assertEmbedEngine("clickhouse")).toThrow(EmbedEngineError);
    expect(() => assertEmbedEngine(null)).toThrow(EmbedEngineError);
    expect(assertEmbedEngine("postgresql")).toBe("postgres");
  });
});

describe("engine helpers", () => {
  test("parseEngine accepts console names and stored connection types", () => {
    expect(parseEngine("postgres")).toBe("postgres");
    expect(parseEngine("PostgreSQL")).toBe("postgres");
    expect(parseEngine("mariadb")).toBe("mysql");
    expect(parseEngine("mongodb")).toBe("mongo");
    expect(parseEngine("mongo")).toBe("mongo");
    expect(parseEngine("redis")).toBe("redis");
    expect(parseEngine("sqlite")).toBeNull();
    expect(parseEngine(5)).toBeNull();
  });

  test("engineToConnectionType and defaultPort", () => {
    expect(engineToConnectionType("mongo")).toBe("mongodb");
    expect(engineToConnectionType("postgres")).toBe("postgres");
    expect(defaultPort("postgres")).toBe(5432);
    expect(defaultPort("mysql")).toBe(3306);
    expect(defaultPort("mongo")).toBe(27017);
    expect(defaultPort("redis")).toBe(6379);
  });
});

describe("redactForClient", () => {
  test("blanks every connection detail and points the connection string at the embed id", () => {
    const redacted = redactForClient({
      id: 7,
      name: "orders",
      connectionType: "postgres",
      connectionString: "embed://u1/d1",
      host: "db.internal",
      port: "5432",
      username: "app",
      password: "leak",
      authToken: "leak",
      color: "red",
    });
    expect(redacted).toEqual({
      id: 7,
      name: "orders",
      connectionType: "postgres",
      connectionString: "embed://7",
      host: null,
      port: null,
      username: null,
      password: null,
      authToken: null,
      color: "red",
    });
  });
});
