// The theme-owned font variables: a preset names its UI and code fonts here, and editors read the code font off the root.

// Read by app/globals.css behind the user's own font (--app-font-sans) and ahead of the default stacks.
export const THEME_FONT_SANS_VAR = "--theme-font-sans";
export const THEME_FONT_MONO_VAR = "--theme-font-mono";

// The self-hosted families app/layout.tsx registers with next/font on <html>; its option must be a literal, so the names repeat there.
export const SELF_HOSTED_SANS_VAR = "--font-inter-self";
export const SELF_HOSTED_MONO_VAR = "--font-jetbrains-mono-self";

// Returns the code font the active theme names on the root, or an empty string when it names none or there is no document.
export function readThemeMonoFont(): string {
  if (typeof document === "undefined") return "";
  return getComputedStyle(document.documentElement).getPropertyValue(THEME_FONT_MONO_VAR).trim();
}

// Resolves an editor's font: the user's setting first, then the theme's code font, else empty for the editor's own default.
export function resolveEditorFontFamily(setting: string | undefined): string {
  const chosen = setting?.trim() ?? "";
  return chosen || readThemeMonoFont();
}
