import { describe, expect, mock, test } from "bun:test";
import net from "node:net";
import * as tunnels from "../../../lib/db/db-tunnel";

/** The real dispatcher, captured before the mock below replaces the module's export. */
const realStartTunnelIfNeeded = tunnels.startTunnelIfNeeded;
/** Local ends of the fake tunnels, by the route name a test writes into its connection string. */
const fakeEnds = new Map<string, number>();
/** How the fake tunnel of a route can be made to go away, and how many times each route was opened. */
const endings = new Map<string, () => void>();
const opens = new Map<string, number>();

// Strings carrying infstudio_test_route=<name> reach that fake end; every other string keeps the real dispatcher.
mock.module("../../../lib/db/db-tunnel", () => ({
  startTunnelIfNeeded: async (cs: string, port: number, normalize: (s: string) => string) => {
    const route = /infstudio_test_route=(\w+)/.exec(cs)?.[1];
    const end = route ? fakeEnds.get(route) : undefined;
    if (end === undefined || !route) return realStartTunnelIfNeeded(cs, port, normalize);
    opens.set(route, (opens.get(route) ?? 0) + 1);
    const closed = new Promise<void>((resolve) => endings.set(route, resolve));
    return { connectionString: `postgresql://u:p@127.0.0.1:${end}/db?sslmode=disable`, close: async () => {}, closed };
  },
}));

/** A local listener standing in for the tunnel's end, counting who connects to it. */
type FakeTunnelEnd = { port: number; connections: () => number; close: () => Promise<void> };

// startTunnelEnd listens on a free loopback port and hangs up on whoever connects, counting them.
function startTunnelEnd(route: string): Promise<FakeTunnelEnd> {
  return new Promise((resolve) => {
    let seen = 0;
    const server = net.createServer((socket) => {
      seen += 1;
      socket.destroy();
    });
    server.listen(0, "127.0.0.1", () => {
      const port = (server.address() as net.AddressInfo).port;
      fakeEnds.set(route, port);
      resolve({ port, connections: () => seen, close: () => new Promise((done) => server.close(() => done())) });
    });
  });
}

describe("the PostgreSQL pool behind a tunnel", () => {
  test("connects to the tunnel's local end, not to the address written in the connection string", async () => {
    const end = await startTunnelEnd("only");
    const { executeQuery } = await import("../../../lib/db/pg-client");
    try {
      await executeQuery("postgresql://u:p@127.0.0.1:1/db?sslmode=disable&infstudio_test_route=only", "SELECT 1").catch(() => {});
      expect(end.connections()).toBeGreaterThan(0);
    } finally {
      await end.close();
    }
  });

  test("two routes to the same private address never share a pool", async () => {
    const first = await startTunnelEnd("a");
    const second = await startTunnelEnd("b");
    const { executeQuery } = await import("../../../lib/db/pg-client");
    try {
      await executeQuery("postgresql://u:p@10.0.10.110:5432/db?sslmode=disable&infstudio_test_route=a", "SELECT 1").catch(() => {});
      await executeQuery("postgresql://u:p@10.0.10.110:5432/db?sslmode=disable&infstudio_test_route=b", "SELECT 1").catch(() => {});
      expect(first.connections()).toBeGreaterThan(0);
      expect(second.connections()).toBeGreaterThan(0);
    } finally {
      await first.close();
      await second.close();
    }
  });

  test("a pool whose tunnel has gone is dropped, so the next query opens a fresh tunnel", async () => {
    const end = await startTunnelEnd("gone");
    const { executeQuery } = await import("../../../lib/db/pg-client");
    const cs = "postgresql://u:p@10.0.10.56:5432/db?sslmode=disable&infstudio_test_route=gone";
    try {
      await executeQuery(cs, "SELECT 1").catch(() => {});
      expect(opens.get("gone")).toBe(1);
      endings.get("gone")?.();
      await new Promise((r) => setTimeout(r, 20));
      await executeQuery(cs, "SELECT 1").catch(() => {});
      expect(opens.get("gone")).toBe(2);
    } finally {
      await end.close();
    }
  });
});
