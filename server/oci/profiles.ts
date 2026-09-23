import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { OciProfile } from "../../lib/oci/oci-database";

// parseOciConfig reads the INI-style ~/.oci/config into profiles; DEFAULT values fill the others' gaps.
export function parseOciConfig(text: string): OciProfile[] {
  const sections = new Map<string, Record<string, string>>();
  let current: Record<string, string> | null = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#") || line.startsWith(";")) continue;
    const header = /^\[(.+)\]$/.exec(line);
    if (header) {
      current = {};
      sections.set(header[1].trim(), current);
      continue;
    }
    const eq = line.indexOf("=");
    if (eq > 0 && current) current[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
  }
  const defaults = sections.get("DEFAULT") ?? {};
  const profiles: OciProfile[] = [];
  for (const [name, values] of sections) {
    const merged = { ...defaults, ...values };
    if (!merged.region || !merged.tenancy) continue;
    profiles.push({ name, region: merged.region, tenancy: merged.tenancy, sessionAuth: Boolean(merged.security_token_file) });
  }
  return profiles;
}

// readOciProfiles loads the profiles from the user's OCI config, or none when the file is absent.
export function readOciProfiles(home: string = os.homedir()): OciProfile[] {
  try {
    return parseOciConfig(fs.readFileSync(path.join(home, ".oci", "config"), "utf8"));
  } catch {
    return [];
  }
}
