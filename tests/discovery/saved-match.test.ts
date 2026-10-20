import { describe, expect, test } from "bun:test";
import { endpointOf, isOciRouted, savedForEndpoint } from "../../lib/discovery/saved-match";

const SAVED = [
  { id: 1, connectionString: "mysql://root:x@localhost:3306/shop" },
  { id: 2, connectionString: "postgresql://u:p@host.docker.internal:5432/scanlink" },
  { id: 3, connectionString: "mysql://app:x@10.0.10.111:3306/?sslmode=require&infstudio_oci_db=ocid1.mysqldbsystem.pre&infstudio_k8s_mode=k8s" },
  { id: 4, connectionString: "mysql://app:x@10.0.10.56:3306/?infstudio_k8s_mode=k8s&infstudio_k8s_cluster=c" },
];

describe("endpointOf", () => {
  test("folds the names of this machine together", () => {
    expect(endpointOf("mysql://a@localhost:3306/x")).toBe("127.0.0.1:3306");
    expect(endpointOf("mysql://a@127.0.0.1:3306/x")).toBe("127.0.0.1:3306");
    expect(endpointOf("sqlite:///tmp/x.db")).toBeNull();
  });
});

describe("savedForEndpoint", () => {
  test("a local database already saved is recognised, whatever the loopback name", () => {
    expect(savedForEndpoint(SAVED, "127.0.0.1", 3306)?.id).toBe(1);
    expect(savedForEndpoint(SAVED, "host.docker.internal", 5432)?.id).toBe(2);
    expect(savedForEndpoint(SAVED, "127.0.0.1", 6379)).toBeNull();
  });
  test("an Oracle Cloud connection is never mistaken for a local one", () => {
    expect(savedForEndpoint(SAVED, "10.0.10.111", 3306)).toBeNull();
  });
});

describe("Oracle Cloud connections", () => {
  test("both new and older cluster-routed connections carry the Oracle Cloud badge", () => {
    expect(isOciRouted(SAVED[2].connectionString)).toBe(true);
    expect(isOciRouted(SAVED[3].connectionString)).toBe(true);
    expect(isOciRouted(SAVED[0].connectionString)).toBe(false);
  });
});
