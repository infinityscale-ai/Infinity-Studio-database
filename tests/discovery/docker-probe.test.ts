import { describe, expect, test } from "bun:test";
import { candidateFromContainer, credentialsFromEnv, discoverDockerDatabases, engineFromImage, publishedPort, reachableAddress, type Addressing } from "../../server/discovery/docker-probe";
import { classifyEngineFailure, engineAddress, type DockerEngine } from "../../server/discovery/docker-engine";

const PG_CONTAINER = {
  Id: "abc",
  Name: "/shop-db",
  Config: { Image: "postgres:16-alpine", Env: ["POSTGRES_PASSWORD=demo", "POSTGRES_DB=demo", "PATH=/usr/bin"] },
  NetworkSettings: { Ports: { "5432/tcp": [{ HostIp: "0.0.0.0", HostPort: "5433" }, { HostIp: "::", HostPort: "5433" }] }, Networks: { mydb_default: { IPAddress: "172.18.0.3" } } },
};
const UNPUBLISHED = { ...PG_CONTAINER, Id: "def", Name: "/compose-pg", NetworkSettings: { Ports: { "5432/tcp": null }, Networks: { mydb_default: { IPAddress: "172.18.0.4" } } } };
const NATIVE: Addressing = { hostAlias: "127.0.0.1", sharedNetworks: new Set() };
const IN_CONTAINER: Addressing = { hostAlias: "host.docker.internal", sharedNetworks: new Set(["mydb_default"]) };

describe("engineFromImage", () => {
  test("recognizes official images with registries, tags and digests", () => {
    expect(engineFromImage("postgres:16-alpine")).toEqual({ engine: "postgres", port: 5432 });
    expect(engineFromImage("docker.io/library/mariadb:11")).toEqual({ engine: "mariadb", port: 3306 });
    expect(engineFromImage("mysql@sha256:abc")).toEqual({ engine: "mysql", port: 3306 });
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

describe("publishedPort and reachableAddress", () => {
  test("a published port is reached through the host alias", () => {
    expect(publishedPort(PG_CONTAINER.NetworkSettings.Ports, 5432)).toBe(5433);
    expect(reachableAddress(PG_CONTAINER.NetworkSettings, 5432, NATIVE)).toEqual({ host: "127.0.0.1", port: 5433 });
    expect(reachableAddress(PG_CONTAINER.NetworkSettings, 5432, IN_CONTAINER)).toEqual({ host: "host.docker.internal", port: 5433 });
  });
  test("an unpublished container is reached on a shared network, or not at all", () => {
    expect(reachableAddress(UNPUBLISHED.NetworkSettings, 5432, IN_CONTAINER)).toEqual({ host: "172.18.0.4", port: 5432 });
    expect(reachableAddress(UNPUBLISHED.NetworkSettings, 5432, NATIVE)).toBeNull();
  });
});

describe("candidateFromContainer", () => {
  test("a published postgres container becomes a candidate with its credentials", () => {
    expect(candidateFromContainer(PG_CONTAINER, NATIVE)).toEqual({ engine: "postgres", host: "127.0.0.1", port: 5433, source: "docker", label: "shop-db (postgres:16-alpine)", container: "shop-db", username: "postgres", password: "demo", database: "demo" });
  });
  test("a non-database container is skipped", () => {
    expect(candidateFromContainer({ Name: "/web", Config: { Image: "nginx" }, NetworkSettings: { Ports: {} } }, NATIVE)).toBeNull();
  });
});

describe("discoverDockerDatabases", () => {
  test("inspects every running container and uses the sidecar's own networks for unpublished ones", async () => {
    const calls: string[] = [];
    const engine: DockerEngine = {
      listRunning: async () => ["abc", "def"],
      inspect: async (id) => {
        calls.push(id);
        if (id === "self") return { NetworkSettings: { Networks: { mydb_default: { IPAddress: "172.18.0.2" } } } };
        return id === "abc" ? PG_CONTAINER : UNPUBLISHED;
      },
    };
    const found = await discoverDockerDatabases({ inContainer: true, hostAlias: "host.docker.internal", selfId: "self" }, engine);
    expect(found.map((c) => `${c.container}@${c.host}:${c.port}`)).toEqual(["shop-db@host.docker.internal:5433", "compose-pg@172.18.0.4:5432"]);
    expect(calls.sort()).toEqual(["abc", "def", "self"]);
  });
});

describe("engine address and failures", () => {
  test("DOCKER_HOST forms", () => {
    expect(engineAddress({})).toEqual({ socketPath: "/var/run/docker.sock" });
    expect(engineAddress({ DOCKER_HOST: "unix:///run/user/1000/docker.sock" })).toEqual({ socketPath: "/run/user/1000/docker.sock" });
    expect(engineAddress({ DOCKER_HOST: "tcp://10.0.0.5:2376" })).toEqual({ host: "10.0.0.5", port: 2376 });
  });
  test("socket errors are explained by kind", () => {
    expect(classifyEngineFailure("ENOENT")).toBe("unavailable");
    expect(classifyEngineFailure("EACCES")).toBe("forbidden");
    expect(classifyEngineFailure("ETIMEDOUT")).toBe("failed");
  });
});
