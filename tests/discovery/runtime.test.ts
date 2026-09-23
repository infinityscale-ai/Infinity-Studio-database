import { describe, expect, test } from "bun:test";
import { detectRuntime } from "../../server/discovery/runtime";

describe("detectRuntime", () => {
  test("outside a container the machine itself is scanned", () => {
    const rt = detectRuntime({}, "/definitely/not/here");
    expect(rt).toEqual({ inContainer: false, hostAlias: "127.0.0.1", selfId: null });
  });
  test("inside a container the host gateway is scanned and the container knows itself", () => {
    const rt = detectRuntime({ INFSTUDIO_IN_CONTAINER: "1" }, "/definitely/not/here");
    expect(rt.inContainer).toBe(true);
    expect(rt.hostAlias).toBe("host.docker.internal");
    expect(typeof rt.selfId).toBe("string");
  });
  test("the host alias can be overridden", () => {
    expect(detectRuntime({ INFSTUDIO_IN_CONTAINER: "1", INFSTUDIO_HOST_ALIAS: "gateway.local" }, "/nope").hostAlias).toBe("gateway.local");
  });
});
