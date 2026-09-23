import type { Express } from "express";
import { mergeCandidates, type DatabaseCandidate, type DiscoverResult, type SourceReport } from "../../lib/discovery/database-candidate";
import { readConfigFileCandidates } from "./config-files";
import { discoverDockerDatabases } from "./docker-probe";
import { probeKnownPorts } from "./tcp-probe";

/** The three detectors, injectable for tests. */
export type DiscoverySources = {
  ports: () => Promise<DatabaseCandidate[]>;
  docker: () => Promise<DatabaseCandidate[]>;
  files: () => DatabaseCandidate[];
};

const DEFAULT_SOURCES: DiscoverySources = {
  ports: () => probeKnownPorts(),
  docker: () => discoverDockerDatabases(),
  files: () => readConfigFileCandidates(),
};

// reportOf turns one detector's settled outcome into its report; a missing docker CLI is unavailable, not an error.
function reportOf(source: SourceReport["source"], outcome: PromiseSettledResult<DatabaseCandidate[]>): SourceReport {
  if (outcome.status === "fulfilled") return { source, status: "ok" };
  const code = (outcome.reason as NodeJS.ErrnoException | undefined)?.code;
  if (source === "docker" && (code === "ENOENT" || /cannot connect to the docker daemon/i.test(String(outcome.reason)))) {
    return { source, status: "unavailable", detail: "Docker is not running here." };
  }
  return { source, status: "error", detail: String((outcome.reason as Error | undefined)?.message || outcome.reason).slice(0, 160) };
}

// discoverLocalDatabases runs every detector, merges what they found and reports which ones answered.
export async function discoverLocalDatabases(sources: DiscoverySources = DEFAULT_SOURCES): Promise<DiscoverResult> {
  const [ports, docker, files] = await Promise.allSettled([sources.ports(), sources.docker(), Promise.resolve().then(sources.files)]);
  const found = [ports, docker, files].map((o) => (o.status === "fulfilled" ? o.value : []));
  return {
    candidates: mergeCandidates(found),
    sources: [reportOf("ports", ports), reportOf("docker", docker), reportOf("files", files)],
  };
}

// mountDiscoveryRoutes adds the local scan endpoint; the caller never mounts it in embed mode.
export function mountDiscoveryRoutes(app: Express): void {
  app.post("/api/discover/local", async (_req, res) => {
    try {
      res.json({ success: true, data: await discoverLocalDatabases() });
    } catch (e) {
      res.status(500).json({ success: false, error: (e as Error).message });
    }
  });
}
