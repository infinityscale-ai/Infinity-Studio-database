import { describe, expect, test } from "bun:test";
import { candidateFromContainer, credentialsFromEnv, discoverDockerDatabases, engineFromImage, publishedPort } from "../../server/discovery/docker-probe";

const PG_CONTAINER = {
  Name: "/shop-db",
  Config: { Image: "postgres:16-alpine", Env: ["POSTGRES_PASSWORD=demo", "POSTGRES_DB=demo", "PATH=/usr/bin"] },
  NetworkSettings: { Ports: { "5432/tcp": [{ HostIp: "0.0.0.0", HostPort: "5433" }, { HostIp: "::", HostPort: "5433" }] } },
};

describe("engineFromImage", () => {
  test("recognizes official images with registries, tags and digests", () => {
    expect(engineFromImage("postgres:16-alpine")).toEqual({ engine: "postgres", port: 5432 });
    expect(engineFromImage("docker.io/library/mariadb:11")).toEqual({ engine: "mariadb", port: 3306 });
    expect(engineFromImage("mysql@sha256:abc")).toEqual({ engine: "mysql", port: 3306 });
    expect(engineFromImage("redis:7-alpine")?.engine).toBe("redis");
    expect(engineFromImage("mcr.microsoft.com/mssql/server:2022-latest")?.engine).toBe("mssql");
    expect(engineFromImage("nginx:1.27")).toBeNull();
  });
});

describe("credentialsFromEnv", () => {
  test("postgres defaults the user and database", () => {
    expect(credentialsFromEnv("postgres", ["POSTGRES_PASSWORD=x"])).toEqual({ username: "postgres", password: "x", database: "postgres" });
  });
  test("mysql prefers the app user, else root", () => {
    expect(credentialsFromEnv("mysql", ["MYSQL_ROOT_PASSWORD=r", "MYSQL_USER=app", "MYSQL_PASSWORD=a", "MYSQL_DATABASE=shop"])).toEqual({ username: "app", password: "a", database: "shop" });
    expect(credentialsFromEnv("mariadb", ["MARIADB_ROOT_PASSWORD=r"])).toEqual({ username: "root", password: "r", database: undefined });
  });
});

describe("publishedPort", () => {
  test("prefers a loopback or wildcard binding and maps it to 127.0.0.1", () => {
    expect(publishedPort(PG_CONTAINER.NetworkSettings.Ports, 5432)).toEqual({ host: "127.0.0.1", port: 5433 });
    expect(publishedPort({ "5432/tcp": null }, 5432)).toBeNull();
    expect(publishedPort(undefined, 5432)).toBeNull();
  });
});

describe("candidateFromContainer", () => {
  test("a published postgres container becomes a candidate with its credentials", () => {
    expect(candidateFromContainer(PG_CONTAINER)).toEqual({ engine: "postgres", host: "127.0.0.1", port: 5433, source: "docker", label: "shop-db (postgres:16-alpine)", container: "shop-db", username: "postgres", password: "demo", database: "demo" });
  });
  test("an unpublished or non-database container is skipped", () => {
    expect(candidateFromContainer({ ...PG_CONTAINER, NetworkSettings: { Ports: { "5432/tcp": null } } })).toBeNull();
    expect(candidateFromContainer({ Name: "/web", Config: { Image: "nginx" }, NetworkSettings: { Ports: {} } })).toBeNull();
  });
});

describe("discoverDockerDatabases", () => {
  test("lists ids then inspects them in one call", async () => {
    const calls: string[][] = [];
    const exec = async (args: string[]) => {
      calls.push(args);
      return args[0] === "ps" ? "abc\ndef\n" : JSON.stringify([PG_CONTAINER, { Name: "/web", Config: { Image: "nginx" }, NetworkSettings: { Ports: {} } }]);
    };
    const found = await discoverDockerDatabases(exec);
    expect(found.map((c) => c.container)).toEqual(["shop-db"]);
    expect(calls).toEqual([["ps", "-q"], ["inspect", "abc", "def"]]);
  });
});
