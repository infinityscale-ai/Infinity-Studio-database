import { describe, expect, test } from "bun:test";
import { summarizeStderr } from "../../server/oci/cli";

describe("summarizeStderr", () => {
  test("keeps the last line of a failure, capped", () => {
    expect(summarizeStderr("line one\n  ServiceError: something bad\n")).toBe("ServiceError: something bad");
    expect(summarizeStderr("x".repeat(500))).toHaveLength(200);
    expect(summarizeStderr("")).toBe("The OCI CLI command failed.");
  });
});
