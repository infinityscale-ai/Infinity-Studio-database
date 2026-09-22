import { describe, expect, test } from "bun:test";
import { readEmbedBearer, redactRowEchoes } from "../../server/embed/middleware";

const row = { id: 7, name: "orders", connectionString: "embed://u1/d1", host: "db.internal", username: "app", port: "5432", password: "x", authToken: "y" };
const redacted = { id: 7, name: "orders", connectionString: "embed://7", host: null, username: null, port: null, password: null, authToken: null };

describe("readEmbedBearer", () => {
  test("returns only emb_ bearers", () => {
    expect(readEmbedBearer({ headers: { authorization: "Bearer emb_abc" } })).toBe("emb_abc");
    expect(readEmbedBearer({ headers: { authorization: "Bearer  emb_abc " } })).toBe("emb_abc");
    expect(readEmbedBearer({ headers: { authorization: "Bearer apikey" } })).toBeNull();
    expect(readEmbedBearer({ headers: { authorization: "Basic emb_abc" } })).toBeNull();
    expect(readEmbedBearer({ headers: {} })).toBeNull();
  });
});

describe("redactRowEchoes", () => {
  test("redacts the bootstrap connection and the connection detail payloads only", () => {
    expect(redactRowEchoes("/studio/7/bootstrap", { success: true, data: { connection: row, tabs: [] } })).toEqual({
      success: true,
      data: { connection: redacted, tabs: [] },
    });
    expect(redactRowEchoes("/api/connections/7", { success: true, data: row })).toEqual({ success: true, data: redacted });
    const untouched = { success: true, data: { connection: row } };
    expect(redactRowEchoes("/studio/7/tabs", untouched)).toBe(untouched);
    expect(redactRowEchoes("/studio/7/bootstrap", { success: true, data: { connection: null } })).toEqual({ success: true, data: { connection: null } });
    expect(redactRowEchoes("/studio/7/bootstrap", "text")).toBe("text");
  });
});
