import { describe, expect, test } from "bun:test";
import { readLocalTools, readServerConfig } from "../../server/web/config";

const local = { embedMode: false, apiKey: "", bind: "127.0.0.1", allowUnauthenticated: false };

describe("readLocalTools", () => {
  test("on for a keyless studio on loopback or a deliberately open bind", () => {
    expect(readLocalTools({}, local)).toBe(true);
    expect(readLocalTools({}, { ...local, bind: "0.0.0.0", allowUnauthenticated: true })).toBe(true);
  });
  test("off as soon as an access key protects the studio, in embed mode, or on an open bind that is not opted in", () => {
    expect(readLocalTools({}, { ...local, apiKey: "secret" })).toBe(false);
    expect(readLocalTools({}, { ...local, embedMode: true })).toBe(false);
    expect(readLocalTools({}, { ...local, bind: "0.0.0.0" })).toBe(false);
  });
  test("INFSTUDIO_LOCAL_TOOLS forces either way", () => {
    expect(readLocalTools({ INFSTUDIO_LOCAL_TOOLS: "1" }, { ...local, apiKey: "secret" })).toBe(true);
    expect(readLocalTools({ INFSTUDIO_LOCAL_TOOLS: "0" }, local)).toBe(false);
  });
  test("the server config carries the decision", () => {
    expect(readServerConfig({ INFSTUDIO_API_KEY: "k" }).localTools).toBe(false);
    expect(readServerConfig({}).localTools).toBe(true);
  });
});
