import { describe, expect, test } from "bun:test";
import { parseMyCnf, parsePgpass } from "../../server/discovery/config-files";

describe("parsePgpass", () => {
  test("reads entries and unescapes colons; wildcard hosts are skipped", () => {
    const found = parsePgpass("# comment\nlocalhost:5432:shop:alice:p\\:ss\n*:5432:*:bob:x\ndb.internal:5433:*:*:y\n");
    expect(found).toHaveLength(2);
    expect(found[0]).toMatchObject({ engine: "postgres", host: "localhost", port: 5432, username: "alice", password: "p:ss", database: "shop", source: "pgpass" });
    expect(found[1]).toMatchObject({ host: "db.internal", port: 5433, username: undefined, database: undefined, password: "y" });
  });
});

describe("parseMyCnf", () => {
  test("reads the client section only", () => {
    const found = parseMyCnf("[mysqld]\nport=3307\n\n[client]\nuser = root\npassword = \"se cret\"\nhost = 127.0.0.1\ndatabase=shop\n");
    expect(found).toEqual([{ engine: "mysql", host: "127.0.0.1", port: 3306, source: "mycnf", label: "~/.my.cnf · root@127.0.0.1:3306", username: "root", password: "se cret", database: "shop" }]);
  });
  test("nothing without a user or host", () => {
    expect(parseMyCnf("[client]\nport=3306\n")).toEqual([]);
  });
});
