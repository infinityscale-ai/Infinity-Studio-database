import { describe, expect, test } from "bun:test";
import { testConnection } from "../../../lib/db/actions-core";

// A PostgreSQL string routed through a cluster, pointing at a port nothing listens on, with a profile that does not exist.
const ROUTED_PG = "postgresql://u:p@127.0.0.1:1/db?sslmode=require&infstudio_k8s_mode=k8s&infstudio_k8s_profile=no-such-profile&infstudio_k8s_cluster=ocid1.cluster.x&infstudio_k8s_namespace=default";

describe("testConnection for PostgreSQL", () => {
  test("goes through the connection's route instead of dialling the address in the string", async () => {
    const result = (await testConnection(ROUTED_PG, "postgres")) as { success: boolean; error?: string };
    expect(result.success).toBe(false);
    expect(result.error ?? "").not.toMatch(/ECONNREFUSED/);
    expect(result.error ?? "").toMatch(/kubectl|profile named no-such-profile/);
  });
});
