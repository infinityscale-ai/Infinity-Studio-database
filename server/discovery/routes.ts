import type { Express } from "express";
import { mergeCandidates, type DatabaseCandidate, type DiscoverResult, type SourceReport } from "../../lib/discovery/database-candidate";
import { readConfigFileCandidates } from "./config-files";
import { DockerEngineError } from "./docker-engine";
import { discoverDockerDatabases } from "./docker-probe";
import { detectRuntime, type DiscoveryRuntime } from "./runtime";
import { probeKnownPorts } from "./tcp-probe";

/** The three detectors, injectable for tests. */
export type DiscoverySources = {
  ports: () => Promise<DatabaseCandidate[]>;
  docker: () => Promise<DatabaseCandidate[]>;
  files: () => DatabaseCandidate[];
};

/** How the Docker source explains each way it can be unusable. */
const DOCKER_DETAILS: Record<string, string> = {
  unavailable: "Docker is not running here.",
  forbidden: "The Docker socket is not readable; start with DOCKER_GID=$(stat -c %g /var/run/docker.sock).",
};

// defaultSources wires the real detectors to where the sidecar runs.
export function defaultSources(runtime: DiscoveryRuntime = detectRuntime()): DiscoverySources {
  return {
    ports: () => probeKnownPorts(runtime.hostAlias),
    docker: () => discoverDockerDatabases(runtime),
    files: () => (runtime.inContainer ? [] : readConfigFileCandidates()),
  };
}

// reportOf turns one detector's settled outcome into its report; a missing or unreadable Docker is explained, not an error.
function reportOf(source: SourceReport["source"], outcome: PromiseSettledResult<DatabaseCandidate[]>): SourceReport {
  if (outcome.status === "fulfilled") return { source, status: "ok" };
  const reason = outcome.reason as (Error & { kind?: string; code?: string }) | undefined;
  if (source === "docker") {
    const kind = reason instanceof DockerEngineError ? reason.kind : reason?.code === "ENOENT" ? "unavailable" : "failed";
    if (kind !== "failed") return { source, status: "unavailable", detail: DOCKER_DETAILS[kind] };
  }
  return { source, status: "error", detail: String(reason?.message || outcome.reason).slice(0, 160) };
}

// discoverLocalDatabases runs every detector, merges what they found and reports which ones answered.
export async function discoverLocalDatabases(sources: DiscoverySources = defaultSources()): Promise<DiscoverResult> {
  const [ports, docker, files] = await Promise.allSettled([sources.ports(), sources.docker(), Promise.resolve().then(sources.files)]);
  const found = [ports, docker, files].map((o) => (o.status === "fulfilled" ? o.value : []));
  return {
    candidates: mergeCandidates(found),
    sources: [reportOf("ports", ports), reportOf("docker", docker), reportOf("files", files)],
  };
}

// mountDiscoveryRoutes adds the local scan endpoint; the caller never mounts it in embed mode.
export function mountDiscoveryRoutes(app: Express): void {
  const sources = defaultSources();
  app.post("/api/discover/local", async (_req, res) => {
    try {
      res.json({ success: true, data: await discoverLocalDatabases(sources) });
    } catch (e) {
      res.status(500).json({ success: false, error: (e as Error).message });
    }
  });
}
