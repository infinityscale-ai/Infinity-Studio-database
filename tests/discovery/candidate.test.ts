import { describe, expect, test } from "bun:test";
import { candidateConnectionString, mergeCandidates, type DatabaseCandidate } from "../../lib/discovery/database-candidate";

const base: DatabaseCandidate = { engine: "postgres", host: "127.0.0.1", port: 5432, source: "port", label: "PostgreSQL on 127.0.0.1:5432" };

describe("candidateConnectionString", () => {
  test("a bare port becomes a host:port string", () => {
    expect(candidateConnectionString(base)).toBe("postgresql://127.0.0.1:5432");
  });
  test("credentials and database are encoded into the string", () => {
    expect(candidateConnectionString({ ...base, engine: "mysql", port: 3306, username: "root", password: "p@ss:1", database: "shop" })).toBe("mysql://root:p%40ss%3A1@127.0.0.1:3306/shop");
  });
  test("redis with only a password keeps the password", () => {
    expect(candidateConnectionString({ ...base, engine: "redis", port: 6379, password: "s" })).toBe("redis://:s@127.0.0.1:6379");
  });
  test("oracle becomes a JDBC thin string", () => {
    const cs = candidateConnectionString({ ...base, engine: "oracle", port: 1521, database: "FREEPDB1" });
    expect(cs.startsWith("jdbc://?jdbcUrl=")).toBe(true);
    expect(decodeURIComponent(cs)).toContain("jdbc:oracle:thin:@//127.0.0.1:1521/FREEPDB1");
  });
});

describe("mergeCandidates", () => {
  test("one entry per endpoint, the one with a password wins", () => {
    const docker: DatabaseCandidate = { ...base, source: "docker", label: "pg (postgres:16)", username: "postgres", password: "demo" };
    const merged = mergeCandidates([[base], [docker]]);
    expect(merged).toHaveLength(1);
    expect(merged[0].source).toBe("docker");
  });
});
