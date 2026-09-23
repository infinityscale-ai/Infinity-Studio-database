import test from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import { probePgSslSupport, resetPgSslProbeCache } from "../../../lib/db/pg-ssl-probe";
import { getPgSslConfig } from "../../../lib/db/pg-ssl";

/** A fake Postgres listener that answers every SSLRequest with one byte and counts its connections. */
type FakeServer = { port: number; connections: number; close: () => Promise<void> };

// startFakePostgres listens on a free loopback port and replies with the given byte to whatever arrives.
function startFakePostgres(answer: "S" | "N"): Promise<FakeServer> {
  return new Promise((resolve) => {
    const state = { connections: 0 };
    const server = net.createServer((socket) => {
      state.connections += 1;
      socket.once("data", () => socket.end(answer));
    });
    server.listen(0, "127.0.0.1", () => {
      const port = (server.address() as net.AddressInfo).port;
      resolve({
        port,
        get connections() {
          return state.connections;
        },
        close: () => new Promise((done) => server.close(() => done())),
      });
    });
  });
}

test("probe reports S as SSL support and N as none", async () => {
  resetPgSslProbeCache();
  const yes = await startFakePostgres("S");
  const no = await startFakePostgres("N");
  try {
    assert.equal(await probePgSslSupport("127.0.0.1", yes.port), true);
    assert.equal(await probePgSslSupport("127.0.0.1", no.port), false);
  } finally {
    await yes.close();
    await no.close();
  }
});

test("probe remembers a server's answer until the cache is reset", async () => {
  resetPgSslProbeCache();
  const server = await startFakePostgres("N");
  try {
    await probePgSslSupport("127.0.0.1", server.port);
    await probePgSslSupport("127.0.0.1", server.port);
    assert.equal(server.connections, 1);
    resetPgSslProbeCache();
    await probePgSslSupport("127.0.0.1", server.port);
    assert.equal(server.connections, 2);
  } finally {
    await server.close();
  }
});

test("probe answers null when nothing listens", async () => {
  resetPgSslProbeCache();
  const closed = await startFakePostgres("N");
  await closed.close();
  assert.equal(await probePgSslSupport("127.0.0.1", closed.port), null);
});

test("prefer falls back to plaintext against a server without SSL", async () => {
  resetPgSslProbeCache();
  const server = await startFakePostgres("N");
  try {
    const url = `postgres://u:p@127.0.0.1:${server.port}/db`;
    assert.equal(await getPgSslConfig(url), false);
    assert.equal(await getPgSslConfig(`${url}?sslmode=allow`), false);
  } finally {
    await server.close();
  }
});

test("prefer keeps SSL against a server that speaks it", async () => {
  resetPgSslProbeCache();
  const server = await startFakePostgres("S");
  try {
    assert.deepEqual(await getPgSslConfig(`postgres://u:p@127.0.0.1:${server.port}/db`), { rejectUnauthorized: false });
  } finally {
    await server.close();
  }
});

test("explicit modes never contact the server", async () => {
  resetPgSslProbeCache();
  const server = await startFakePostgres("N");
  try {
    const url = `postgres://u:p@127.0.0.1:${server.port}/db?sslmode=`;
    assert.equal(await getPgSslConfig(`${url}disable`), false);
    assert.deepEqual(await getPgSslConfig(`${url}require`), { rejectUnauthorized: false });
    assert.deepEqual(await getPgSslConfig(`${url}verify-full`), { rejectUnauthorized: true });
    assert.deepEqual(await getPgSslConfig(`${url}verify-ca`), { rejectUnauthorized: true });
    assert.equal(server.connections, 0);
  } finally {
    await server.close();
  }
});

test("prefer keeps the old SSL attempt when the probe cannot reach the server", async () => {
  resetPgSslProbeCache();
  const closed = await startFakePostgres("N");
  await closed.close();
  assert.deepEqual(await getPgSslConfig(`postgres://u:p@127.0.0.1:${closed.port}/db`), { rejectUnauthorized: false });
});
