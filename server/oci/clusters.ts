import type { OciDatabaseTarget } from "../../lib/oci/oci-database";
import type { ApiRecord, OciClient } from "./api";
import { str } from "./inventory";

/** One Kubernetes cluster the studio could reach a database through. */
export type OkeCluster = { id: string; name: string; vcnId: string; state: string; publicEndpoint: string };

/** Cluster states that can still serve an API request. */
const USABLE = new Set(["ACTIVE", "UPDATING"]);

// toCluster normalizes one OKE cluster record.
export function toCluster(raw: ApiRecord): OkeCluster {
  const endpoints = (raw.endpoints ?? {}) as ApiRecord;
  return { id: str(raw, "id"), name: str(raw, "name"), vcnId: str(raw, "vcnId"), state: str(raw, "lifecycleState"), publicEndpoint: str(endpoints, "publicEndpoint") };
}

// pickCluster chooses the usable cluster with a public API endpoint that sits in the database's own network.
export function pickCluster(clusters: OkeCluster[], target: Pick<OciDatabaseTarget, "vcnId">): OkeCluster | null {
  return clusters.find((c) => c.vcnId === target.vcnId && USABLE.has(c.state) && c.publicEndpoint !== "") ?? null;
}

// findClusterForDatabase lists the tenancy's clusters and returns the one that shares the database's network, or null.
export async function findClusterForDatabase(client: OciClient, target: OciDatabaseTarget): Promise<OkeCluster | null> {
  const clusters = (await client.listClusters(target.compartmentId)).map(toCluster);
  return pickCluster(clusters, target);
}
