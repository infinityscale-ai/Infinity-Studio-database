import { describe, expect, test } from "bun:test";
import { autoAddName, pickAutoAdditions } from "../../lib/discovery/auto-add";
import type { DatabaseCandidate } from "../../lib/discovery/database-candidate";

const LIMS: DatabaseCandidate = { engine: "mysql", host: "host.docker.internal", port: 3306, source: "docker", label: "lims-mysql (mariadb:11)", container: "lims-mysql", username: "root", database: "lims" };
const REDIS: DatabaseCandidate = { engine: "redis", host: "host.docker.internal", port: 6379, source: "port", label: "Redis on host.docker.internal:6379" };
const PG: DatabaseCandidate = { engine: "postgres", host: "host.docker.internal", port: 5432, source: "docker", label: "global-postgres", container: "global-postgres", username: "scanlink", password: "pw", database: "scanlink" };

describe("pickAutoAdditions", () => {
  test("every found database not saved yet is added, with its provider and a ready connection string", () => {
    const picked = pickAutoAdditions([LIMS, REDIS], [], new Set());
    expect(picked.map((p) => p.name)).toEqual(["lims-mysql", "Redis on port 6379"]);
    expect(picked[0]).toMatchObject({ connectionType: "mysql", connectionString: "mysql://root@host.docker.internal:3306/lims" });
    expect(picked[1]).toMatchObject({ connectionType: "redis", connectionString: "redis://host.docker.internal:6379" });
  });
  test("a database already saved under the same host and port is not added twice", () => {
    const saved = [{ id: 1, connectionString: "mysql://root@host.docker.internal:3306/lims" }];
    expect(pickAutoAdditions([LIMS, PG], saved, new Set()).map((p) => p.name)).toEqual(["global-postgres"]);
  });
  test("one added before and then deleted by the user stays deleted", () => {
    expect(pickAutoAdditions([LIMS], [], new Set(["host.docker.internal:3306"]))).toEqual([]);
  });
  test("the PostgreSQL provider id is the one the connection form uses", () => {
    expect(pickAutoAdditions([PG], [], new Set())[0].connectionType).toBe("postgresql");
  });
});

describe("autoAddName", () => {
  test("a container keeps its name; a bare port says the engine and port", () => {
    expect(autoAddName(LIMS)).toBe("lims-mysql");
    expect(autoAddName(REDIS)).toBe("Redis on port 6379");
  });
});
