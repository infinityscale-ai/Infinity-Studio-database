import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { DatabaseCandidate } from "../../lib/discovery/database-candidate";

// splitPgpassLine splits one .pgpass line on unescaped colons and unescapes the fields.
function splitPgpassLine(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === "\\" && i + 1 < line.length) {
      current += line[++i];
    } else if (ch === ":") {
      fields.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  fields.push(current);
  return fields;
}

// parsePgpass reads ~/.pgpass entries (host:port:database:user:password) into candidates; wildcard hosts and ports are skipped.
export function parsePgpass(text: string): DatabaseCandidate[] {
  const out: DatabaseCandidate[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const [host, portText, database, username, password] = splitPgpassLine(line);
    const port = Number(portText);
    if (!host || host === "*" || !Number.isInteger(port)) continue;
    out.push({ engine: "postgres", host, port, source: "pgpass", label: `~/.pgpass · ${username || "?"}@${host}:${port}`, username: username && username !== "*" ? username : undefined, password: password || undefined, database: database && database !== "*" ? database : undefined });
  }
  return out;
}

// parseMyCnf reads the [client] section of ~/.my.cnf into one candidate when it names a user or a host.
export function parseMyCnf(text: string): DatabaseCandidate[] {
  let inClient = false;
  const values: Record<string, string> = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#") || line.startsWith(";")) continue;
    const header = /^\[(.+)\]$/.exec(line);
    if (header) {
      inClient = header[1].trim().toLowerCase() === "client";
      continue;
    }
    const eq = line.indexOf("=");
    if (inClient && eq > 0) values[line.slice(0, eq).trim().toLowerCase()] = line.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
  }
  if (!values.user && !values.host) return [];
  const host = values.host || "127.0.0.1";
  const port = Number(values.port) || 3306;
  return [{ engine: "mysql", host, port, source: "mycnf", label: `~/.my.cnf · ${values.user || "?"}@${host}:${port}`, username: values.user, password: values.password, database: values.database }];
}

// readIfPresent returns a file's text, or an empty string when it does not exist.
function readIfPresent(file: string): string {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return "";
  }
}

// readConfigFileCandidates loads ~/.pgpass and ~/.my.cnf, tolerating their absence.
export function readConfigFileCandidates(home: string = os.homedir()): DatabaseCandidate[] {
  return [...parsePgpass(readIfPresent(path.join(home, ".pgpass"))), ...parseMyCnf(readIfPresent(path.join(home, ".my.cnf")))];
}
