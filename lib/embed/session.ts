// Embed-session state for the console-hosted studio; the embed claim flow extends this module.
export const EMBED_SESSION_STORAGE_KEY = "infinity-studio:embed-session";

// Reports whether this page runs as the console-embedded studio (served under /embed).
export function isEmbedMode(): boolean {
  if (typeof window === "undefined") return false;
  const { pathname } = window.location;
  return pathname === "/embed" || pathname.startsWith("/embed/");
}

// Returns the embed session bearer once a claim has stored it, else null.
export function getEmbedBearer(): string | null {
  if (!isEmbedMode()) return null;
  try {
    return window.sessionStorage.getItem(EMBED_SESSION_STORAGE_KEY);
  } catch {
    return null;
  }
}
