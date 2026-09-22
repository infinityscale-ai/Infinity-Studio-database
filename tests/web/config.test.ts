import { describe, expect, test } from "bun:test";
import { isLoopback, readServerConfig, validateServerConfig } from "../../server/web/config";

const ADMIN_KEY = "k".repeat(32);

describe("readServerConfig", () => {
  test("defaults to the loopback sidecar with no static dir and a free port", () => {
    const cfg = readServerConfig({});
    expect(cfg.port).toBe(3867);
    expect(cfg.bind).toBe("127.0.0.1");
    expect(cfg.strictPort).toBe(false);
    expect(cfg.staticDir).toBeNull();
    expect(cfg.dataDir).toBe(process.cwd());
    expect(cfg.apiKey).toBe("");
    expect(cfg.allowUnauthenticated).toBe(false);
    expect(cfg.corsOrigins).toEqual([]);
    expect(cfg.embedMode).toBe(false);
    expect(cfg.embedAllowedOrigins).toEqual([]);
    expect(cfg.consoleOrigin).toBeNull();
    expect(cfg.admin).toBeNull();
    expect(cfg.mcpDisabled).toBe(false);
  });

  test("an explicit bind pins the port", () => {
    expect(readServerConfig({ INFSTUDIO_BIND: "0.0.0.0" }).strictPort).toBe(true);
  });

  test("an explicit port pins the port", () => {
    const cfg = readServerConfig({ INFSTUDIO_SERVER_PORT: "4000" });
    expect(cfg.port).toBe(4000);
    expect(cfg.strictPort).toBe(true);
  });

  test("a malformed port falls back to the default but still pins", () => {
    const cfg = readServerConfig({ INFSTUDIO_SERVER_PORT: "abc" });
    expect(cfg.port).toBe(3867);
    expect(cfg.strictPort).toBe(true);
  });

  test("reads the container environment", () => {
    const cfg = readServerConfig({
      INFSTUDIO_BIND: "0.0.0.0",
      INFSTUDIO_SERVER_PORT: "3867",
      INFSTUDIO_USER_DATA_DIR: "/data",
      INFSTUDIO_STATIC_DIR: "/app/out",
      INFSTUDIO_MCP_DISABLED: "1",
      INFSTUDIO_API_KEY: " secret ",
      INFSTUDIO_CORS_ORIGINS: "https://a.example, https://b.example,,",
      INFSTUDIO_EMBED_ALLOWED_ORIGINS: "https://console.example",
      INFSTUDIO_CONSOLE_ORIGIN: "https://console.example",
      INFSTUDIO_ALLOW_UNAUTHENTICATED: "true",
    });
    expect(cfg.dataDir).toBe("/data");
    expect(cfg.staticDir).toBe("/app/out");
    expect(cfg.mcpDisabled).toBe(true);
    expect(cfg.apiKey).toBe("secret");
    expect(cfg.corsOrigins).toEqual(["https://a.example", "https://b.example"]);
    expect(cfg.embedAllowedOrigins).toEqual(["https://console.example"]);
    expect(cfg.consoleOrigin).toBe("https://console.example");
    expect(cfg.allowUnauthenticated).toBe(true);
  });

  test("reads the admin listener with its defaults", () => {
    const cfg = readServerConfig({ INFSTUDIO_ADMIN_PORT: "3868", INFSTUDIO_ADMIN_KEY: ADMIN_KEY });
    expect(cfg.admin).toEqual({ port: 3868, bind: "127.0.0.1", key: ADMIN_KEY });
  });
});

describe("isLoopback", () => {
  test("recognises local addresses only", () => {
    expect(isLoopback("127.0.0.1")).toBe(true);
    expect(isLoopback("127.0.1.5")).toBe(true);
    expect(isLoopback("localhost")).toBe(true);
    expect(isLoopback("::1")).toBe(true);
    expect(isLoopback("0.0.0.0")).toBe(false);
    expect(isLoopback("::")).toBe(false);
    expect(isLoopback("10.0.0.2")).toBe(false);
  });
});

describe("validateServerConfig", () => {
  test("loopback without a key is fine", () => {
    expect(validateServerConfig(readServerConfig({}))).toEqual([]);
  });

  test("a public bind without a key is fatal", () => {
    const problems = validateServerConfig(readServerConfig({ INFSTUDIO_BIND: "0.0.0.0" }));
    expect(problems.map((p) => p.key)).toEqual(["INFSTUDIO_API_KEY"]);
    expect(problems[0].message).toContain("refusing to bind 0.0.0.0 without INFSTUDIO_API_KEY");
  });

  test("a public bind passes with a key, an explicit opt-out, or embed mode", () => {
    expect(validateServerConfig(readServerConfig({ INFSTUDIO_BIND: "0.0.0.0", INFSTUDIO_API_KEY: "k" }))).toEqual([]);
    expect(validateServerConfig(readServerConfig({ INFSTUDIO_BIND: "0.0.0.0", INFSTUDIO_ALLOW_UNAUTHENTICATED: "1" }))).toEqual([]);
    const embed = readServerConfig({
      INFSTUDIO_BIND: "0.0.0.0",
      INFSTUDIO_EMBED_MODE: "1",
      INFSTUDIO_ADMIN_PORT: "3868",
      INFSTUDIO_ADMIN_KEY: ADMIN_KEY,
    });
    expect(validateServerConfig(embed)).toEqual([]);
  });

  test("a short admin key is fatal", () => {
    const cfg = readServerConfig({ INFSTUDIO_ADMIN_PORT: "3868", INFSTUDIO_ADMIN_KEY: "short" });
    expect(validateServerConfig(cfg).map((p) => p.key)).toEqual(["INFSTUDIO_ADMIN_KEY"]);
  });

  test("an unparsable admin port is fatal", () => {
    const cfg = readServerConfig({ INFSTUDIO_ADMIN_PORT: "nope", INFSTUDIO_ADMIN_KEY: ADMIN_KEY });
    expect(validateServerConfig(cfg).map((p) => p.key)).toEqual(["INFSTUDIO_ADMIN_PORT"]);
  });

  test("embed mode without the admin listener is fatal", () => {
    const cfg = readServerConfig({ INFSTUDIO_EMBED_MODE: "1" });
    expect(validateServerConfig(cfg).map((p) => p.key)).toEqual(["INFSTUDIO_EMBED_MODE"]);
  });
});
