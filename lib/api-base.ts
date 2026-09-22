// API base resolution and access headers for every call to the Infinity Studio server.
import { isDesktopRuntime } from "@/lib/desktop";
import { getEmbedBearer, isEmbedMode } from "@/lib/embed/session";

export const DEFAULT_LOOPBACK_BASE = "http://127.0.0.1:3867";
export const API_KEY_STORAGE_KEY = "infinity-studio:api-key";
export const UNAUTHORIZED_EVENT = "infinity-studio:unauthorized";

export type ApiBaseInput = {
  isDesktop: boolean;
  envBase: string | undefined;
  origin: string | undefined;
};

export type UnauthorizedDetail = { embed: boolean };

// Trims whitespace and trailing slashes; a blank value yields null.
function normalizeBase(value: string | undefined): string | null {
  const trimmed = value?.trim().replace(/\/+$/, "");
  return trimmed ? trimmed : null;
}

// Picks the API base: desktop keeps the loopback default until Tauri discovery replaces it,
// the web build uses NEXT_PUBLIC_INFSTUDIO_API_BASE when set and its own origin otherwise.
export function resolveApiBase({ isDesktop, envBase, origin }: ApiBaseInput): string {
  if (isDesktop) return DEFAULT_LOOPBACK_BASE;
  return normalizeBase(envBase) ?? normalizeBase(origin) ?? DEFAULT_LOOPBACK_BASE;
}

// Exported as let so the Tauri runtime can update it after port discovery.
export let API_BASE = resolveApiBase({
  isDesktop: isDesktopRuntime(),
  envBase: process.env.NEXT_PUBLIC_INFSTUDIO_API_BASE,
  origin: typeof window === "undefined" ? undefined : window.location.origin,
});

// Discovers the real sidecar port from Tauri; a no-op outside the desktop shell.
export async function initApiBase(): Promise<void> {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    const url = await invoke<string>("get_api_base_url");
    if (url) API_BASE = url;
  } catch {
    // not running inside Tauri; keep the resolved base
  }
}

// Reads the server access key the user entered this browser session, if any.
export function readStoredApiKey(): string | null {
  try {
    return window.sessionStorage.getItem(API_KEY_STORAGE_KEY);
  } catch {
    return null;
  }
}

// Remembers the server access key for this browser session.
export function storeApiKey(key: string): void {
  try {
    window.sessionStorage.setItem(API_KEY_STORAGE_KEY, key);
  } catch {
    // storage unavailable; the key still works for this page load through the header
  }
}

// Forgets the stored server access key.
export function clearStoredApiKey(): void {
  try {
    window.sessionStorage.removeItem(API_KEY_STORAGE_KEY);
  } catch {
    // nothing stored
  }
}

// Selects the bearer to send: the embed session first, then the stored access key.
export function selectBearer(embedBearer: string | null, storedKey: string | null): string | null {
  return embedBearer || storedKey || null;
}

// Builds the Authorization header for the current session; empty when there is nothing to send.
export function getAuthHeaders(): Record<string, string> {
  const bearer = selectBearer(getEmbedBearer(), readStoredApiKey());
  return bearer ? { Authorization: `Bearer ${bearer}` } : {};
}

// Tells the app that the server rejected the current credentials.
function dispatchUnauthorized(): void {
  if (typeof window === "undefined") return;
  const detail: UnauthorizedDetail = { embed: isEmbedMode() };
  window.dispatchEvent(new CustomEvent<UnauthorizedDetail>(UNAUTHORIZED_EVENT, { detail }));
}

// Fetches from the server with the API base and access headers applied; announces a 401.
export async function apiFetch(url: string, init?: RequestInit): Promise<Response> {
  const resolved = url.startsWith("http") ? url : `${API_BASE}${url}`;
  const headers = new Headers(init?.headers);
  for (const [name, value] of Object.entries(getAuthHeaders())) {
    if (!headers.has(name)) headers.set(name, value);
  }
  const response = await fetch(resolved, { ...init, headers });
  if (response.status === 401) dispatchUnauthorized();
  return response;
}
