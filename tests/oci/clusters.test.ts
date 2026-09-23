import { describe, expect, test } from "bun:test";
import { pickCluster, toCluster } from "../../server/oci/clusters";

const raw = (over: Record<string, unknown> = {}) => ({ id: "c1", name: "Laprophan_Prod", vcnId: "v1", lifecycleState: "ACTIVE", endpoints: { publicEndpoint: "51.170.130.155:6443" }, ...over });

describe("pickCluster", () => {
  test("takes the usable cluster in the database's own network", () => {
    const clusters = [toCluster(raw({ id: "other", vcnId: "v2" })), toCluster(raw())];
    expect(pickCluster(clusters, { vcnId: "v1" })?.id).toBe("c1");
  });
  test("ignores clusters in another network, deleted ones, and ones with no public endpoint", () => {
    expect(pickCluster([toCluster(raw({ vcnId: "v9" }))], { vcnId: "v1" })).toBeNull();
    expect(pickCluster([toCluster(raw({ lifecycleState: "DELETED" }))], { vcnId: "v1" })).toBeNull();
    expect(pickCluster([toCluster(raw({ endpoints: {} }))], { vcnId: "v1" })).toBeNull();
  });
});
