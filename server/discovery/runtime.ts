import fs from "node:fs";
import os from "node:os";

/** Where the sidecar runs, and how it must address databases published on the machine. */
export type DiscoveryRuntime = { inContainer: boolean; hostAlias: string; selfId: string | null };

/** The name Docker gives the host from inside a container when compose maps it to the host gateway. */
const CONTAINER_HOST_ALIAS = "host.docker.internal";

// flag reads a boolean env value.
function flag(value: string | undefined): boolean {
  return ["1", "true", "yes"].includes((value ?? "").trim().toLowerCase());
}

// detectRuntime tells whether the sidecar sits in a container, so scans target the host instead of the container itself.
export function detectRuntime(env: Record<string, string | undefined> = process.env, dockerEnvFile = "/.dockerenv"): DiscoveryRuntime {
  const inContainer = flag(env.INFSTUDIO_IN_CONTAINER) || fs.existsSync(dockerEnvFile);
  const hostAlias = env.INFSTUDIO_HOST_ALIAS?.trim() || (inContainer ? CONTAINER_HOST_ALIAS : "127.0.0.1");
  return { inContainer, hostAlias, selfId: inContainer ? os.hostname() : null };
}
