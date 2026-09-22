// The catalog of selectable theme ids: the built-in app themes, the built-in editor themes, and which editor theme pairs with an app theme.
import { BUILTIN_APP_THEMES } from "../app-themes";
import { INFINITYSCALE_APP_THEME_ID, INFINITYSCALE_EDITOR_THEME_ID } from "./infinityscale";

export type ThemeSelection = { app: string; editor: string };
export type EditorThemeOption = { id: string; label: string };

export const AUTO_EDITOR_THEME_ID = "auto";

export const BUILTIN_EDITOR_THEMES: readonly EditorThemeOption[] = [
  { id: AUTO_EDITOR_THEME_ID, label: "Auto (follow app)" },
  { id: "studio-dark", label: "Studio Dark" },
  { id: INFINITYSCALE_EDITOR_THEME_ID, label: "InfinityScale Dark" },
  { id: "light", label: "Light" },
  { id: "vs-dark", label: "VS Dark" },
  { id: "hc-black", label: "High Contrast" },
];

const PAIRED_EDITOR_THEMES: Readonly<Record<string, string>> = {
  [INFINITYSCALE_APP_THEME_ID]: INFINITYSCALE_EDITOR_THEME_ID,
};

// Reports whether an id names a built-in app theme.
export function isKnownAppThemeId(id: string): boolean {
  return BUILTIN_APP_THEMES.some((theme) => theme.id === id);
}

// Reports whether an id names a built-in editor theme.
export function isKnownEditorThemeId(id: string): boolean {
  return BUILTIN_EDITOR_THEMES.some((theme) => theme.id === id);
}

// Returns the editor theme an app theme pairs with; "auto" derives one from the app theme's colours.
export function pairedEditorThemeId(appThemeId: string): string {
  return PAIRED_EDITOR_THEMES[appThemeId] ?? AUTO_EDITOR_THEME_ID;
}

// Reads a `{ app, editor }` selection out of untrusted data, or null when either id is missing or not a string.
export function parseThemeSelection(value: unknown): ThemeSelection | null {
  if (typeof value !== "object" || value === null) return null;
  const { app, editor } = value as Record<string, unknown>;
  if (typeof app !== "string" || app === "" || typeof editor !== "string" || editor === "") return null;
  return { app, editor };
}
