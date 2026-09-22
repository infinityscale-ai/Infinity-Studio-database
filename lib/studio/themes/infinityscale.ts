// The InfinityScale preset: the hosting console's palette, radius and fonts as an app theme, plus its paired Monaco theme.
import type { CustomAppTheme } from "../app-themes";
import type { MonacoThemeDefinition, MonacoThemeRule } from "../editor-themes";
import { SELF_HOSTED_MONO_VAR, SELF_HOSTED_SANS_VAR, THEME_FONT_MONO_VAR, THEME_FONT_SANS_VAR } from "./theme-fonts";

export const INFINITYSCALE_APP_THEME_ID = "infinityscale";
export const INFINITYSCALE_EDITOR_THEME_ID = "infinityscale-dark";

// The console's shadcn contract, as hex of the exact HSL triples it defines.
const BACKGROUND = "#0a0814"; // 250 42.9% 5.5%
const FOREGROUND = "#f7f7f8"; // 240 6.7% 97.1%
const CARD = "#1a1824"; // 250 20% 11.8%
const PRIMARY = "#6e56cf"; // 251.9 55.8% 57.5%
const SECONDARY = "#2a2636"; // 255 17.4% 18%
const MUTED = "#242030"; // 255 20% 15.7%
const MUTED_FOREGROUND = "#9b97a8"; // 254.1 8.9% 62.5%
const DESTRUCTIVE = "#ef4444"; // 0 84.2% 60.2%
const BORDER = "#2e2a3a"; // 255 16% 19.6%
const WHITE = "#ffffff"; // 0 0% 100%
const RADIUS = "0.625rem";

// The console's own tokens: the surface under its sidebar, rail and status bar, and its status hues.
const SURFACE = "#121018"; // 255 20% 7.8%
const WARNING = "#eab308"; // 45.4 93.4% 47.5%
const SUCCESS = "#4ade80"; // --status-live 141.9 69.2% 58%

// The console's avatar and chart hues, all at or above 9.6:1 on the background, for syntax and charts.
const LAVENDER = "#b9a9ff"; // 251.2 100% 83.1%
const PINK = "#f9a8d4"; // 327.4 87.1% 81.8%
const CYAN = "#7dd3fc"; // 199.4 95.5% 73.9%
const AMBER = "#fcd34d"; // 45.9 96.7% 64.5%
const GREEN = "#6ee7b7"; // 156.2 71.6% 66.9%

// Hover and active steps: the same hues moved in lightness only.
const PRIMARY_HOVER = "#5a3ec8"; // 251.9 55.8% 51.5%
const PRIMARY_DEEP = "#442d9f"; // 251.9 55.8% 40%
const BORDER_HOVER = "#383347"; // 255 16% 24%
const BORDER_ACTIVE = "#423c53"; // 255 16% 28%
const LIST_FOCUS = "#312c3f"; // 255 17.4% 21%
const SELECTION = "rgba(110, 86, 207, 0.3)"; // primary at 30%
const SELECTION_HEX = "#6e56cf4d"; // the same, as Monaco reads it

export const INFINITYSCALE_APP_THEME: CustomAppTheme = {
  id: INFINITYSCALE_APP_THEME_ID,
  name: "InfinityScale",
  base: "dark",
  colors: {
    "--background": BACKGROUND,
    "--foreground": FOREGROUND,
    "--card": CARD,
    "--card-foreground": FOREGROUND,
    "--popover": CARD,
    "--popover-foreground": FOREGROUND,
    "--primary": PRIMARY,
    "--primary-foreground": WHITE,
    "--secondary": SECONDARY,
    "--secondary-foreground": FOREGROUND,
    "--muted": MUTED,
    "--muted-foreground": MUTED_FOREGROUND,
    "--accent": PRIMARY,
    "--accent-foreground": WHITE,
    "--destructive": DESTRUCTIVE,
    "--destructive-foreground": WHITE,
    "--border": BORDER,
    "--input": BORDER,
    "--ring": PRIMARY,
    "--radius": RADIUS,
    "--success": SUCCESS,
    "--success-foreground": SUCCESS,
    "--warning": WARNING,
    "--warning-foreground": AMBER,
    "--info": PRIMARY,
    "--info-foreground": LAVENDER,
    "--chart-1": PRIMARY,
    "--chart-2": CYAN,
    "--chart-3": GREEN,
    "--chart-4": AMBER,
    "--chart-5": PINK,
    "--sidebar": SURFACE,
    "--sidebar-foreground": FOREGROUND,
    "--sidebar-primary": PRIMARY,
    "--sidebar-primary-foreground": WHITE,
    "--sidebar-accent": MUTED,
    "--sidebar-accent-foreground": FOREGROUND,
    "--sidebar-border": BORDER,
    "--sidebar-ring": PRIMARY,
    "--ai-chat-bg": CARD,
    "--shell-content-bg": "var(--studio-bg)",
    "--shell-tab-active-bg": "var(--studio-tab-active)",
    "--shell-tab-inactive-bg": "var(--studio-tab-inactive)",
    "--shell-history-bg": "var(--studio-bg)",
    "--studio-bg": BACKGROUND,
    "--studio-border": BORDER,
    "--studio-header-bg": SURFACE,
    "--table-header-bg": CARD,
    "--studio-cell-text": FOREGROUND,
    "--studio-cell-muted": MUTED_FOREGROUND,
    "--studio-tab-active": BACKGROUND,
    "--studio-tab-inactive": SURFACE,
    "--studio-row-hover": MUTED,
    "--studio-selection": SELECTION,
    "--studio-accent-purple": PRIMARY,
    "--title-bar-bg": SURFACE,
    "--title-bar-fg": FOREGROUND,
    "--activity-bar-bg": SURFACE,
    "--activity-bar-fg": FOREGROUND,
    "--activity-bar-inactive": MUTED_FOREGROUND,
    "--activity-bar-active-border": PRIMARY,
    "--side-bar-bg": SURFACE,
    "--side-bar-fg": FOREGROUND,
    "--side-bar-header-bg": SURFACE,
    "--panel-bg": SURFACE,
    "--panel-fg": FOREGROUND,
    "--panel-border": BORDER,
    "--panel-header-bg": SURFACE,
    "--status-bar-bg": SURFACE,
    "--status-bar-fg": MUTED_FOREGROUND,
    "--shell-bg": BACKGROUND,
    "--shell-fg": FOREGROUND,
    "--shell-fg-muted": MUTED_FOREGROUND,
    "--shell-border": BORDER,
    "--shell-chip": CARD,
    "--shell-chip-hover": MUTED,
    "--shell-chip-active": SECONDARY,
    "--shell-sidebar": SURFACE,
    "--shell-panel": CARD,
    "--tab-active-bg": BACKGROUND,
    "--tab-active-fg": FOREGROUND,
    "--tab-inactive-bg": SURFACE,
    "--tab-inactive-fg": MUTED_FOREGROUND,
    "--tab-hover-bg": MUTED,
    "--tab-border": BORDER,
    "--tab-active-border-top": PRIMARY,
    "--editor-widget-bg": CARD,
    "--editor-widget-fg": FOREGROUND,
    "--editor-widget-border": BORDER,
    "--menu-bg": CARD,
    "--menu-fg": FOREGROUND,
    "--menu-separator": BORDER,
    "--notification-bg": CARD,
    "--notification-fg": FOREGROUND,
    "--notification-border": BORDER,
    "--button-bg": PRIMARY,
    "--button-fg": WHITE,
    "--button-hover-bg": PRIMARY_HOVER,
    "--badge-bg": PRIMARY_DEEP,
    "--badge-fg": WHITE,
    "--input-bg": SURFACE,
    "--input-fg": FOREGROUND,
    "--input-border": BORDER,
    "--input-placeholder": MUTED_FOREGROUND,
    "--progress-bar-bg": PRIMARY,
    "--scrollbar-bg": BORDER,
    "--scrollbar-hover-bg": BORDER_HOVER,
    "--scrollbar-active-bg": BORDER_ACTIVE,
    "--list-hover-bg": MUTED,
    "--list-hover-fg": FOREGROUND,
    "--list-active-bg": SECONDARY,
    "--list-active-fg": FOREGROUND,
    "--list-focus-bg": LIST_FOCUS,
    "--list-focus-fg": FOREGROUND,
    "--editor-group-bg": BACKGROUND,
    "--editor-group-border": BORDER,
    "--editor-group-tabs-bg": SURFACE,
    "--editor-group-tabs-border": BORDER,
    "--syntax-keyword": LAVENDER,
    "--syntax-string": GREEN,
    "--syntax-number": AMBER,
    "--syntax-function": CYAN,
    "--syntax-variable": PINK,
    "--syntax-comment": MUTED_FOREGROUND,
    "--syntax-type": CYAN,
    [THEME_FONT_SANS_VAR]: `var(${SELF_HOSTED_SANS_VAR}), "Inter", -apple-system, "Segoe UI", sans-serif`,
    [THEME_FONT_MONO_VAR]: `var(${SELF_HOSTED_MONO_VAR}), "JetBrains Mono", ui-monospace, monospace`,
  },
};

// Builds one Monaco token rule; Monaco wants the hex without its "#".
function rule(token: string, hex: string, fontStyle?: string): MonacoThemeRule {
  return { token, foreground: hex.slice(1), ...(fontStyle ? { fontStyle } : {}) };
}

// The paired Monaco theme: the preset's ground, the console's purple cursor, card widgets, and the same syntax hues as --syntax-*.
export const INFINITYSCALE_EDITOR_THEME: MonacoThemeDefinition = {
  base: "vs-dark",
  inherit: true,
  rules: [
    rule("comment", MUTED_FOREGROUND),
    rule("string", GREEN),
    rule("string.sql", GREEN),
    rule("number", AMBER),
    rule("keyword", LAVENDER, "bold"),
    rule("keyword.sql", LAVENDER, "bold"),
    rule("operator", FOREGROUND),
    rule("delimiter", FOREGROUND),
    rule("type", CYAN),
    rule("function", CYAN),
    rule("identifier", FOREGROUND),
    rule("variable", PINK),
  ],
  colors: {
    "editor.background": BACKGROUND,
    "editor.foreground": FOREGROUND,
    "editor.lineHighlightBackground": MUTED,
    "editor.selectionBackground": SELECTION_HEX,
    "editor.inactiveSelectionBackground": SELECTION_HEX,
    "editor.selectionHighlightBackground": SELECTION_HEX,
    "editor.wordHighlightBackground": SELECTION_HEX,
    "editor.wordHighlightStrongBackground": SELECTION_HEX,
    "editor.findMatchBackground": SELECTION_HEX,
    "editor.findMatchHighlightBackground": SELECTION_HEX,
    "editor.findRangeHighlightBackground": SELECTION_HEX,
    "editor.rangeHighlightBackground": SELECTION_HEX,
    "editorGutter.background": BACKGROUND,
    "editorGutter.foreground": MUTED_FOREGROUND,
    "editorLineNumber.foreground": MUTED_FOREGROUND,
    "editorLineNumber.activeForeground": LAVENDER,
    "editorCursor.foreground": PRIMARY,
    "editorIndentGuide.background": BORDER,
    "editorIndentGuide.activeBackground": BORDER,
    "editorBracketMatch.background": SELECTION_HEX,
    "editorBracketMatch.border": BORDER,
    "editorWhitespace.foreground": BORDER,
    "editorWidget.background": CARD,
    "editorWidget.border": BORDER,
    "editorSuggestWidget.background": CARD,
    "editorSuggestWidget.border": BORDER,
    "editorSuggestWidget.selectedBackground": SECONDARY,
    "editorHoverWidget.background": CARD,
    "editorHoverWidget.border": BORDER,
    "focusBorder": PRIMARY,
    "scrollbarSlider.background": BORDER,
    "scrollbarSlider.hoverBackground": BORDER_HOVER,
    "scrollbarSlider.activeBackground": BORDER_ACTIVE,
  },
};
