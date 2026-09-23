import { describe, expect, test } from "bun:test";
import { classifyOciFailure, profileArgs, summarizeStderr } from "../../server/oci/cli";

describe("classifyOciFailure", () => {
  test("ENOENT means the CLI is not installed", () => {
    expect(classifyOciFailure("", "ENOENT")).toBe("not-installed");
  });
  test("an expired token reads as session-expired", () => {
    expect(classifyOciFailure("ServiceError: status 401 NotAuthenticated", 1)).toBe("session-expired");
    expect(classifyOciFailure("ERROR: The security token has expired", 1)).toBe("session-expired");
    expect(classifyOciFailure("Do you want to re-authenticate your CLI session profile? [Y/n]: \nAbort:", 1)).toBe("session-expired");
  });
  test("anything else is a plain failure", () => {
    expect(classifyOciFailure("ServiceError: 404 NotAuthorizedOrNotFound", 1)).toBe("failed");
  });
});

describe("profileArgs", () => {
  test("session profiles add security_token auth", () => {
    expect(profileArgs({ name: "p", region: "r", tenancy: "t", sessionAuth: true })).toEqual(["--profile", "p", "--region", "r", "--output", "json", "--auth", "security_token"]);
  });
  test("api-key profiles do not", () => {
    expect(profileArgs({ name: "p", region: "r", tenancy: "t", sessionAuth: false })).toEqual(["--profile", "p", "--region", "r", "--output", "json"]);
  });
});

describe("summarizeStderr", () => {
  test("keeps the last line of a failure, capped", () => {
    expect(summarizeStderr("line one\n  ServiceError: something bad\n", "failed")).toBe("ServiceError: something bad");
    expect(summarizeStderr("x".repeat(500), "failed")).toHaveLength(200);
  });
});
