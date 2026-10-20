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
  test("a container with an empty root password still beats the bare port, so its name and user are kept", () => {
    const port: DatabaseCandidate = { engine: "mysql", host: "host.docker.internal", port: 3306, source: "port", label: "MySQL / MariaDB on host.docker.internal:3306" };
    const docker: DatabaseCandidate = { ...port, source: "docker", label: "lims-mysql (mariadb:11)", container: "lims-mysql", username: "root", database: "lims" };
    expect(mergeCandidates([[port], [docker]])[0].container).toBe("lims-mysql");
    expect(mergeCandidates([[docker], [port]])[0].container).toBe("lims-mysql");
  });
  test("a password-less container (Redis) still beats the bare port", () => {
    const port: DatabaseCandidate = { engine: "redis", host: "h", port: 6379, source: "port", label: "Redis on h:6379" };
    const docker: DatabaseCandidate = { ...port, source: "docker", label: "global-redis (redis:7)", container: "global-redis" };
    expect(mergeCandidates([[port], [docker]])[0].container).toBe("global-redis");
  });
});

describe("MongoDB candidates", () => {
  test("a user from the image's root credentials authenticates against admin, not the app database", () => {
    const cs = candidateConnectionString({ engine: "mongodb", host: "127.0.0.1", port: 27017, source: "docker", label: "global-mongo", username: "scanlink", password: "pw", database: "scanlink" });
    const url = new URL(cs);
    expect(url.pathname).toBe("/scanlink");
    expect(url.searchParams.get("authSource")).toBe("admin");
  });
  test("a MongoDB without credentials needs no authSource", () => {
    expect(candidateConnectionString({ engine: "mongodb", host: "127.0.0.1", port: 27018, source: "docker", label: "brand-mongo" })).toBe("mongodb://127.0.0.1:27018");
  });
});
