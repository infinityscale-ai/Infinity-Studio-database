import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { OciProfile } from "../../lib/oci/oci-database";

/** Everything a profile needs to sign requests; never leaves the sidecar. */
export type OciCredentialProfile = OciProfile & {
  user: string;
  fingerprint: string;
  keyFile: string;
  tokenFile: string | null;
  passPhrase: string | null;
};

// ociConfigDir is where the sign-in files live: INFSTUDIO_OCI_DIR, else ~/.oci.
export function ociConfigDir(env: Record<string, string | undefined> = process.env, home: string = os.homedir()): string {
  return env.INFSTUDIO_OCI_DIR?.trim() || path.join(home, ".oci");
}

// expandHome resolves a leading ~ in a configured file path.
export function expandHome(file: string, home: string = os.homedir()): string {
  return file.startsWith("~/") || file === "~" ? path.join(home, file.slice(1)) : file;
}

// parseOciConfigSections reads the INI-style config into named sections, DEFAULT values filling the others' gaps.
export function parseOciConfigSections(text: string): Map<string, Record<string, string>> {
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
  for (const [name, values] of sections) if (name !== "DEFAULT") sections.set(name, { ...defaults, ...values });
  return sections;
}

// toCredentialProfile turns one section into a signing profile, or null when it cannot sign anything.
export function toCredentialProfile(name: string, values: Record<string, string>, home: string = os.homedir()): OciCredentialProfile | null {
  if (!values.region || !values.tenancy || !values.key_file) return null;
  const tokenFile = values.security_token_file ? expandHome(values.security_token_file, home) : null;
  if (!tokenFile && (!values.user || !values.fingerprint)) return null;
  return {
    name,
    region: values.region,
    tenancy: values.tenancy,
    sessionAuth: tokenFile !== null,
    user: values.user ?? "",
    fingerprint: values.fingerprint ?? "",
    keyFile: expandHome(values.key_file, home),
    tokenFile,
    passPhrase: values.pass_phrase ?? null,
  };
}

// parseOciConfig reads the config text into the profiles that can sign requests.
export function parseOciConfig(text: string, home: string = os.homedir()): OciCredentialProfile[] {
  const out: OciCredentialProfile[] = [];
  for (const [name, values] of parseOciConfigSections(text)) {
    const profile = toCredentialProfile(name, values, home);
    if (profile) out.push(profile);
  }
  return out;
}

// publicProfile strips a credential profile down to what the browser may see.
export function publicProfile(p: OciCredentialProfile): OciProfile {
  return { name: p.name, region: p.region, tenancy: p.tenancy, sessionAuth: p.sessionAuth };
}

// readCredentialProfiles loads the profiles from the config directory, or none when the file is absent.
export function readCredentialProfiles(dir: string = ociConfigDir()): OciCredentialProfile[] {
  try {
    return parseOciConfig(fs.readFileSync(path.join(dir, "config"), "utf8"));
  } catch {
    return [];
  }
}

// readOciProfiles is the browser-safe view of the same list.
export function readOciProfiles(dir: string = ociConfigDir()): OciProfile[] {
  return readCredentialProfiles(dir).map(publicProfile);
}
