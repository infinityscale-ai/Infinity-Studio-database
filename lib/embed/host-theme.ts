// The look the console chose for an embedded session: read from the stored session, painted before the studio renders, cached for the pre-paint script.
import { applyAppThemeVariables, BUILTIN_APP_THEMES, type CustomAppTheme } from "@/lib/studio/app-themes";
import { isKnownAppThemeId, type ThemeSelection } from "@/lib/studio/themes/theme-catalog";
import { getEmbedSession, isEmbedMode } from "./session";

// Where the painted host theme waits for the next reload; the inline script in app/layout.tsx applies it before paint.
export const EMBED_THEME_VARS_STORAGE_KEY = "infinity-studio:embed-theme-vars";

// Returns the theme the console chose for this session, or null when the studio keeps its own look or this build lacks the preset.
export function getHostTheme(): ThemeSelection | null {
  if (!isEmbedMode()) return null;
  const theme = getEmbedSession()?.theme ?? null;
  return theme !== null && isKnownAppThemeId(theme.app) ? theme : null;
}

// Reports whether the console owns the look, which hides the theme and font pickers and keeps theme state out of localStorage.
export function hasHostTheme(): boolean {
  return getHostTheme() !== null;
}

// Finds the preset behind a host theme selection, or null.
export function resolveHostAppTheme(selection: ThemeSelection): CustomAppTheme | null {
  return BUILTIN_APP_THEMES.find((theme) => theme.id === selection.app) ?? null;
}

// Paints the host theme on the root before the studio renders and caches its variables for the next reload's first paint.
export function applyHostTheme(root: HTMLElement, selection: ThemeSelection): void {
  const theme = resolveHostAppTheme(selection);
  if (!theme) return;
  applyAppThemeVariables(root, theme.colors, []);
  root.dataset.appTheme = theme.id;
  root.classList.remove("light", "dark");
  root.classList.add(theme.base);
  root.style.colorScheme = theme.base;
  try {
    window.sessionStorage.setItem(
      EMBED_THEME_VARS_STORAGE_KEY,
      JSON.stringify({ id: theme.id, base: theme.base, colors: theme.colors }),
    );
  } catch {
    // storage unavailable: the next reload paints after the claim instead
  }
}
