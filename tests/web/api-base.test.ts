import { describe, expect, test } from "bun:test";
import { DEFAULT_LOOPBACK_BASE, getAuthHeaders, resolveApiBase, selectBearer } from "../../lib/api-base";
import { decideApiKeyGate } from "../../components/gates/api-key-gate";

describe("resolveApiBase", () => {
  test("desktop always starts on the loopback default, whatever else is set", () => {
    expect(resolveApiBase({ isDesktop: true, envBase: "https://api.example", origin: "https://app.example" })).toBe(DEFAULT_LOOPBACK_BASE);
  });

  test("the web build prefers the configured base over its origin", () => {
    expect(resolveApiBase({ isDesktop: false, envBase: "https://api.example/", origin: "https://app.example" })).toBe("https://api.example");
  });

  test("the web build falls back to its own origin", () => {
    expect(resolveApiBase({ isDesktop: false, envBase: undefined, origin: "https://studio.example" })).toBe("https://studio.example");
    expect(resolveApiBase({ isDesktop: false, envBase: "  ", origin: "https://studio.example/" })).toBe("https://studio.example");
  });

  test("with nothing to go on it keeps the loopback default", () => {
    expect(resolveApiBase({ isDesktop: false, envBase: undefined, origin: undefined })).toBe(DEFAULT_LOOPBACK_BASE);
  });
});

describe("selectBearer", () => {
  test("the embed session wins over a stored key", () => {
    expect(selectBearer("embed-token", "stored-key")).toBe("embed-token");
  });

  test("a stored key is used when there is no embed session", () => {
    expect(selectBearer(null, "stored-key")).toBe("stored-key");
    expect(selectBearer("", "stored-key")).toBe("stored-key");
  });

  test("nothing is sent when neither exists", () => {
    expect(selectBearer(null, null)).toBeNull();
    expect(selectBearer("", "")).toBeNull();
  });
});

describe("getAuthHeaders", () => {
  test("sends no header outside a browser session", () => {
    expect(getAuthHeaders()).toEqual({});
  });
});

describe("decideApiKeyGate", () => {
  test("desktop and embed pass through, the plain web build probes", () => {
    expect(decideApiKeyGate({ isDesktop: true, isEmbed: false })).toBe("pass");
    expect(decideApiKeyGate({ isDesktop: false, isEmbed: true })).toBe("pass");
    expect(decideApiKeyGate({ isDesktop: true, isEmbed: true })).toBe("pass");
    expect(decideApiKeyGate({ isDesktop: false, isEmbed: false })).toBe("probe");
  });
});
