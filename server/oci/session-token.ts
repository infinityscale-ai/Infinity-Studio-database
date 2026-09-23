import fs from "node:fs";

/** What a session token says about itself. */
export type TokenInfo = { token: string; expiresAt: number | null };

// decodeTokenExpiry reads the exp claim (seconds) out of a JWT session token, or null when it has none.
export function decodeTokenExpiry(token: string): number | null {
  const parts = token.trim().split(".");
  if (parts.length !== 3) return null;
  try {
    const payload = JSON.parse(Buffer.from(parts[1].replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8")) as { exp?: unknown };
    return typeof payload.exp === "number" ? payload.exp * 1000 : null;
  } catch {
    return null;
  }
}

// readSessionToken loads a profile's token file, or null when there is none to read.
export function readSessionToken(tokenFile: string | null): TokenInfo | null {
  if (!tokenFile) return null;
  try {
    const token = fs.readFileSync(tokenFile, "utf8").trim();
    return token ? { token, expiresAt: decodeTokenExpiry(token) } : null;
  } catch {
    return null;
  }
}

// isTokenLive reports whether a token is still usable, with a minute of slack for clock drift.
export function isTokenLive(info: TokenInfo | null, now: number = Date.now()): boolean {
  if (!info) return false;
  return info.expiresAt === null || info.expiresAt - 60_000 > now;
}
