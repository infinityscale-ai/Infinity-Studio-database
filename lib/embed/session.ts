// Embed-session state for the console-hosted studio: the claimed bearer, its identity, and the parent-window signals.
import { parseThemeSelection, type ThemeSelection } from "@/lib/studio/themes/theme-catalog";

export const EMBED_SESSION_STORAGE_KEY = "infinity-studio:embed-session";

export type EmbedSessionInfo = {
  bearer: string;
  connectionId: number;
  externalId: string;
  displayName: string;
  expiresAt: number;
  engine: string;
  label: string;
  consoleOrigin: string;
  claimedToken: string;
  theme: ThemeSelection | null;
};

export type EmbedParentMessage = "infinity-studio:ready" | "infinity-studio:session-expired";

const STRING_FIELDS = ["bearer", "externalId", "displayName", "engine", "label", "consoleOrigin", "claimedToken"] as const;

// The session read from sessionStorage once per page load; undefined until the first read.
let cached: EmbedSessionInfo | null | undefined;

// Reports whether this page runs as the console-embedded studio (served under /embed); no location means no page.
export function isEmbedMode(): boolean {
  if (typeof window === "undefined") return false;
  const pathname = window.location?.pathname ?? "";
  return pathname === "/embed" || pathname.startsWith("/embed/");
}

// Validates a parsed storage value into a session, or null when any field is missing or mistyped; a malformed theme is just no theme.
export function parseEmbedSession(value: unknown): EmbedSessionInfo | null {
  if (typeof value !== "object" || value === null) return null;
  const rec = value as Record<string, unknown>;
  if (!STRING_FIELDS.every((field) => typeof rec[field] === "string")) return null;
  if (typeof rec.connectionId !== "number" || typeof rec.expiresAt !== "number") return null;
  const { bearer, externalId, displayName, engine, label, consoleOrigin, claimedToken } = rec as Record<(typeof STRING_FIELDS)[number], string>;
  const theme = parseThemeSelection(rec.theme);
  return { bearer, externalId, displayName, engine, label, consoleOrigin, claimedToken, connectionId: rec.connectionId, expiresAt: rec.expiresAt, theme };
}

// Returns this tab's stored embed session, or null; read from sessionStorage once and cached.
export function getEmbedSession(): EmbedSessionInfo | null {
  if (!isEmbedMode()) return null;
  if (cached !== undefined) return cached;
  try {
    const raw = window.sessionStorage.getItem(EMBED_SESSION_STORAGE_KEY);
    cached = raw ? parseEmbedSession(JSON.parse(raw)) : null;
  } catch {
    cached = null;
  }
  return cached;
}

// Returns the embed session bearer once a claim has stored it, else null.
export function getEmbedBearer(): string | null {
  return getEmbedSession()?.bearer ?? null;
}

// Remembers the claimed session for this tab; the bearer still works for this page load when storage is unavailable.
export function storeEmbedSession(info: EmbedSessionInfo): void {
  cached = info;
  try {
    window.sessionStorage.setItem(EMBED_SESSION_STORAGE_KEY, JSON.stringify(info));
  } catch {
    // storage unavailable
  }
}

// Forgets the session so no further request carries its bearer.
export function clearEmbedSession(): void {
  cached = null;
  try {
    window.sessionStorage.removeItem(EMBED_SESSION_STORAGE_KEY);
  } catch {
    // nothing stored
  }
}

// Reports whether a session's expiry has passed.
export function isEmbedSessionExpired(info: EmbedSessionInfo, now: number = Date.now()): boolean {
  return now >= info.expiresAt;
}

// Posts a signal to the hosting console when the page is framed; a no-op at top level.
export function notifyParent(type: EmbedParentMessage): void {
  if (typeof window === "undefined" || window.parent === window) return;
  const origin = getEmbedSession()?.consoleOrigin || "*";
  window.parent.postMessage({ type }, origin);
}
