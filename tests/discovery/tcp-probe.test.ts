import { describe, expect, test } from "bun:test";
import net from "node:net";
import { isPortOpen, probeKnownPorts } from "../../server/discovery/tcp-probe";
import { discoverLocalDatabases } from "../../server/discovery/routes";

// listen opens a throwaway TCP listener on a free loopback port.
function listen(): Promise<{ port: number; close: () => void }> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.listen(0, "127.0.0.1", () => resolve({ port: (server.address() as net.AddressInfo).port, close: () => server.close() }));
  });
}

describe("isPortOpen", () => {
  test("true for a listener, false for a closed port", async () => {
    const l = await listen();
    try {
      expect(await isPortOpen("127.0.0.1", l.port)).toBe(true);
    } finally {
      l.close();
    }
    expect(await isPortOpen("127.0.0.1", l.port)).toBe(false);
  });
});

describe("probeKnownPorts", () => {
  test("returns only the open ports as candidates", async () => {
    const l = await listen();
    try {
      const found = await probeKnownPorts("127.0.0.1", [{ port: l.port, engine: "postgres", label: "PostgreSQL" }, { port: 1, engine: "redis", label: "Redis" }]);
      expect(found).toEqual([{ engine: "postgres", host: "127.0.0.1", port: l.port, source: "port", label: `PostgreSQL on 127.0.0.1:${l.port}` }]);
    } finally {
      l.close();
    }
  });
});

describe("discoverLocalDatabases", () => {
  test("merges sources and reports a missing docker as unavailable", async () => {
    const enoent = Object.assign(new Error("spawn docker ENOENT"), { code: "ENOENT" });
    const result = await discoverLocalDatabases({
      ports: async () => [{ engine: "postgres", host: "127.0.0.1", port: 5432, source: "port", label: "pg" }],
      docker: async () => { throw enoent; },
      files: () => [{ engine: "postgres", host: "127.0.0.1", port: 5432, source: "pgpass", label: "pgpass", username: "u", password: "p" }],
    });
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0].source).toBe("pgpass");
    expect(result.sources.find((s) => s.source === "docker")).toEqual({ source: "docker", status: "unavailable", detail: "Docker is not running here." });
  });
});
