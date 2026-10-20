import { describe, expect, test } from "bun:test";
import { emptyValues, localhostConnectionString, valuesFrom, withLocalEngine } from "../../components/connections/use-localhost-connect";

describe("localhostConnectionString", () => {
  test("a database with no login connects with none", () => {
    const v = { ...emptyValues("host.docker.internal"), engine: "redis" as const, port: "6379" };
    expect(localhostConnectionString(v)).toBe("redis://host.docker.internal:6379");
  });
  test("a typed login and database go into the URL, encoded", () => {
    const v = { ...emptyValues("127.0.0.1"), database: "lims", username: "root", password: "p@ss" };
    expect(localhostConnectionString(v)).toBe("mysql://root:p%40ss@127.0.0.1:3306/lims");
  });
});

describe("withLocalEngine", () => {
  test("the port follows the engine until the user typed their own", () => {
    expect(withLocalEngine(emptyValues("h"), "postgres").port).toBe("5432");
    expect(withLocalEngine({ ...emptyValues("h"), port: "3307" }, "postgres").port).toBe("3307");
  });
});

describe("valuesFrom", () => {
  test("a found container fills engine, address, database and the login it knew", () => {
    const v = valuesFrom({ engine: "mariadb", host: "host.docker.internal", port: 3306, source: "docker", label: "lims-mysql", container: "lims-mysql", username: "root", database: "lims" });
    expect(v).toEqual({ name: "lims-mysql", engine: "mariadb", host: "host.docker.internal", port: "3306", database: "lims", username: "root", password: "" });
  });
  test("an engine the form does not offer fills nothing", () => {
    expect(valuesFrom({ engine: "mssql", host: "h", port: 1433, source: "port", label: "" })).toBeNull();
  });
});
