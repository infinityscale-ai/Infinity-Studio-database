import { createHash, randomBytes } from "node:crypto";
import type { ThemeSelection } from "../../lib/studio/themes/theme-catalog";

export type EmbedEngine = "postgres" | "mysql" | "mongo" | "redis";
export const EMBED_ENGINES: readonly EmbedEngine[] = ["postgres", "mysql", "mongo", "redis"];

export type EmbedConnectionOptions = { authSource?: string; sslmode?: string };
export type EmbedSecret = { password: string; options: EmbedConnectionOptions };

export type EmbedIdentity = {
  connectionId: number;
  externalId: string;
  userId: string;
  dbId: string;
  displayName: string;
  engine: EmbedEngine;
  label: string;
  theme?: ThemeSelection | null;
};

export type EmbedSession = EmbedIdentity & {
  id: string;
  createdAt: number;
  expiresAt: number;
  revoked: boolean;
};

export type MintInput = EmbedIdentity & { ttlSeconds: number; tokenTtlSeconds?: number };
export type MintResult = { token: string; expiresAt: number };
export type ClaimError = "token_used" | "token_expired";
export type ClaimResult = { bearer: string; session: EmbedSession } | { error: ClaimError };
export type LookupError = "embed_session_expired" | "embed_session_revoked";
export type LookupResult = { ok: true; session: EmbedSession } | { ok: false; error: LookupError };
export type EmbedStoreOptions = { now?: () => number; tokenTtlMs?: number; maxBadTries?: number };

export type EmbedStore = {
  mintToken(input: MintInput): MintResult;
  claim(token: string): ClaimResult;
  resolve(bearer: string): EmbedSession | null;
  lookup(bearer: string): LookupResult;
  setSecret(connectionId: number, secret: EmbedSecret): void;
  getSecret(connectionId: number): EmbedSecret | null;
  deleteSecret(connectionId: number): void;
  revokeByDb(dbId: string): number;
  revokeByUser(userId: string): number;
  revokeByExternalId(externalId: string): number;
  revokeSession(id: string): number;
  sweep(): number;
};

type PendingToken = EmbedIdentity & { ttlSeconds: number; tokenExpiresAt: number; usedAt: number | null };
type BadTry = { count: number; at: number };

export const DEFAULT_SESSION_TTL_SECONDS = 28_800;
export const MAX_SESSION_TTL_SECONDS = 86_400;
export const DEFAULT_TOKEN_TTL_SECONDS = 60;
export const MAX_TOKEN_TTL_SECONDS = 300;
const DEFAULT_MAX_BAD_TRIES = 5;
const BAD_TRY_RETENTION_MS = 600_000;

// Hashes a credential with SHA-256 so only digests are ever kept in memory.
export function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

// Generates a prefixed random credential of 32 bytes in base64url.
function randomCredential(prefix: string): string {
  return prefix + randomBytes(32).toString("base64url");
}

// Clamps a ttl in seconds to [1, max], falling back to the default when absent.
function clampTtl(value: number | undefined, fallback: number, max: number): number {
  const n = typeof value === "number" && Number.isFinite(value) ? Math.floor(value) : fallback;
  return Math.min(Math.max(n, 1), max);
}

// Copies only the identity fields off a pending token or session; the console's theme choice rides along.
function identityOf(source: EmbedIdentity): EmbedIdentity {
  const { connectionId, externalId, userId, dbId, displayName, engine, label } = source;
  return { connectionId, externalId, userId, dbId, displayName, engine, label, theme: source.theme ?? null };
}

// Creates the in-process store of single-use tokens, bearer sessions and per-connection secrets.
export function createEmbedStore(options: EmbedStoreOptions = {}): EmbedStore {
  const now = options.now ?? Date.now;
  const defaultTokenTtl = options.tokenTtlMs === undefined ? DEFAULT_TOKEN_TTL_SECONDS : options.tokenTtlMs / 1000;
  const maxBadTries = options.maxBadTries ?? DEFAULT_MAX_BAD_TRIES;
  const tokens = new Map<string, PendingToken>();
  const sessions = new Map<string, EmbedSession>();
  const secrets = new Map<number, EmbedSecret>();
  const badTries = new Map<string, BadTry>();

  // Counts a failed claim for a token hash and drops the token once the lockout threshold is reached.
  function failClaim(hash: string, error: ClaimError): ClaimResult {
    const entry = badTries.get(hash) ?? { count: 0, at: now() };
    entry.count += 1;
    entry.at = now();
    badTries.set(hash, entry);
    if (entry.count >= maxBadTries) tokens.delete(hash);
    return { error };
  }

  // Marks matching sessions revoked, discards matching tokens (counting unclaimed ones), and forgets their secrets.
  function revokeWhere(match: (identity: EmbedIdentity) => boolean): number {
    let count = 0;
    const connectionIds = new Set<number>();
    for (const session of sessions.values()) {
      if (session.revoked || !match(session)) continue;
      session.revoked = true;
      connectionIds.add(session.connectionId);
      count += 1;
    }
    for (const [hash, token] of tokens) {
      if (!match(token)) continue;
      tokens.delete(hash);
      connectionIds.add(token.connectionId);
      if (token.usedAt === null) count += 1;
    }
    for (const id of connectionIds) secrets.delete(id);
    return count;
  }

  const store: EmbedStore = {
    // Issues a single-use claim token whose digest maps to the identity and clamped ttls.
    mintToken(input) {
      const token = randomCredential("tok_");
      const tokenTtl = clampTtl(input.tokenTtlSeconds ?? defaultTokenTtl, DEFAULT_TOKEN_TTL_SECONDS, MAX_TOKEN_TTL_SECONDS);
      const expiresAt = now() + tokenTtl * 1000;
      tokens.set(digest(token), {
        ...identityOf(input),
        ttlSeconds: clampTtl(input.ttlSeconds, DEFAULT_SESSION_TTL_SECONDS, MAX_SESSION_TTL_SECONDS),
        tokenExpiresAt: expiresAt,
        usedAt: null,
      });
      return { token, expiresAt };
    },
    // Exchanges an unused, unexpired token for a bearer session; failures count toward the lockout.
    claim(token) {
      const hash = digest(token);
      const pending = tokens.get(hash);
      if (!pending) return failClaim(hash, "token_expired");
      if (pending.usedAt !== null) return failClaim(hash, "token_used");
      const at = now();
      if (at >= pending.tokenExpiresAt) {
        tokens.delete(hash);
        return { error: "token_expired" };
      }
      const bearer = randomCredential("emb_");
      const session: EmbedSession = {
        ...identityOf(pending),
        id: digest(bearer),
        createdAt: at,
        expiresAt: at + pending.ttlSeconds * 1000,
        revoked: false,
      };
      pending.usedAt = at;
      sessions.set(session.id, session);
      return { bearer, session };
    },
    // Finds the live session for a bearer and says why it is unusable otherwise.
    lookup(bearer) {
      const session = sessions.get(digest(bearer));
      if (!session || now() >= session.expiresAt) return { ok: false, error: "embed_session_expired" };
      if (session.revoked) return { ok: false, error: "embed_session_revoked" };
      return { ok: true, session };
    },
    // Returns the live session for a bearer, or null.
    resolve(bearer) {
      const found = store.lookup(bearer);
      return found.ok ? found.session : null;
    },
    // Parks a connection's password and driver options in memory only.
    setSecret(connectionId, secret) {
      secrets.set(connectionId, secret);
    },
    // Returns the in-memory secret for a connection, or null after a restart or revocation.
    getSecret(connectionId) {
      return secrets.get(connectionId) ?? null;
    },
    // Forgets a connection's secret.
    deleteSecret(connectionId) {
      secrets.delete(connectionId);
    },
    // Revokes every session and unclaimed token on one database.
    revokeByDb(dbId) {
      return revokeWhere((identity) => identity.dbId === dbId);
    },
    // Revokes every session and unclaimed token of one user.
    revokeByUser(userId) {
      return revokeWhere((identity) => identity.userId === userId);
    },
    // Revokes every session and unclaimed token of one user/database pair.
    revokeByExternalId(externalId) {
      return revokeWhere((identity) => identity.externalId === externalId);
    },
    // Revokes one session by id; reports 1 when it was live.
    revokeSession(id) {
      const session = sessions.get(id);
      if (!session || session.revoked) return 0;
      session.revoked = true;
      return 1;
    },
    // Drops expired tokens, expired sessions and stale lockout counters; returns how many were removed.
    sweep() {
      const at = now();
      let removed = 0;
      for (const [hash, token] of tokens) {
        if (at < token.tokenExpiresAt) continue;
        tokens.delete(hash);
        removed += 1;
      }
      for (const [id, session] of sessions) {
        if (at < session.expiresAt) continue;
        sessions.delete(id);
        removed += 1;
      }
      for (const [hash, entry] of badTries) {
        if (at - entry.at >= BAD_TRY_RETENTION_MS) badTries.delete(hash);
      }
      return removed;
    },
  };
  return store;
}

// Runs sweep() on an interval that never keeps the process alive; returns a stop function.
export function startSweeper(store: EmbedStore, intervalMs = 60_000): () => void {
  const timer = setInterval(() => store.sweep(), intervalMs);
  timer.unref();
  return () => clearInterval(timer);
}
