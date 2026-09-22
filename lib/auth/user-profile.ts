"use client";

import { getStoredUserProfile, upsertUserProfile } from "@/lib/api/actions-client";

export const DISPLAY_NAME_STORAGE_KEY = "infinity-studio-display-name";
export const LOCAL_USER_ID = "local";
export const PROFILE_CHANGED_EVENT = "infinity-studio-profile-changed";

export interface LocalUserProfile {
  name: string;
  email: string | null;
}

// Trims a value to a non-empty string, or returns null.
function normalizeText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

// Reads the display name cached in localStorage, or an empty string.
export function loadStoredDisplayName(): string {
  if (typeof window === "undefined") return "";
  return normalizeText(window.localStorage.getItem(DISPLAY_NAME_STORAGE_KEY)) ?? "";
}

// Caches the display name in localStorage and tells listeners the profile changed.
function storeDisplayName(name: string): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(DISPLAY_NAME_STORAGE_KEY, name);
  window.dispatchEvent(new CustomEvent(PROFILE_CHANGED_EVENT));
}

// Resolves the local profile from the users table, falling back to the cached name.
export async function resolveLocalUserProfile(): Promise<LocalUserProfile> {
  const cachedName = loadStoredDisplayName();
  const stored = await getStoredUserProfile(LOCAL_USER_ID).catch(() => null);
  const storedName = normalizeText(stored?.data?.name);
  return {
    name: storedName ?? cachedName ?? "User",
    email: normalizeText(stored?.data?.email),
  };
}

// Saves the local user's name (and optional email) to the users table and the cache.
export async function saveLocalUserProfile(name: string, email?: string | null) {
  const trimmedName = normalizeText(name) ?? "User";
  const result = await upsertUserProfile({
    id: LOCAL_USER_ID,
    name: trimmedName,
    email: normalizeText(email),
    isLocal: true,
  });
  if (result.success) storeDisplayName(trimmedName);
  return { name: trimmedName, result };
}

// Creates the local profile on first run; the same write as saving it later.
export function activateLocalUserProfile(name: string) {
  return saveLocalUserProfile(name);
}
