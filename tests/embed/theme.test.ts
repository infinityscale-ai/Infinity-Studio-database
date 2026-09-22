import { describe, expect, test } from "bun:test";
import { BUILTIN_APP_THEMES } from "../../lib/studio/app-themes";
import {
  INFINITYSCALE_APP_THEME,
  INFINITYSCALE_APP_THEME_ID,
  INFINITYSCALE_EDITOR_THEME,
  INFINITYSCALE_EDITOR_THEME_ID,
} from "../../lib/studio/themes/infinityscale";
import {
  BUILTIN_EDITOR_THEMES,
  isKnownAppThemeId,
  isKnownEditorThemeId,
  pairedEditorThemeId,
  parseThemeSelection,
} from "../../lib/studio/themes/theme-catalog";
import { THEME_FONT_MONO_VAR, THEME_FONT_SANS_VAR } from "../../lib/studio/themes/theme-fonts";
import { parseAdminSessionRequest } from "../../server/embed/admin-validation";
import { createEmbedStore } from "../../server/embed/sessions";

const BASE_DARK = BUILTIN_APP_THEMES.find((theme) => theme.id === "infinity-studio-dark");
const SELECTION = { app: INFINITYSCALE_APP_THEME_ID, editor: INFINITYSCALE_EDITOR_THEME_ID };

// Builds a valid admin session body with overrides.
function sessionBody(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    externalId: "u1/d1", userId: "u1", dbId: "d1", label: "orders", engine: "postgres",
    host: "db.internal", port: 5432, username: "app", password: "p", database: "orders", ...over,
  };
}

// Parses a body and returns the theme it resolved, or the failure code.
function themeOf(body: Record<string, unknown>, fallback: { app: string; editor: string } | null = null) {
  const parsed = parseAdminSessionRequest(body, fallback);
  return parsed.ok ? parsed.value.theme : parsed.code;
}

describe("the InfinityScale preset", () => {
  test("defines every variable the base dark theme defines, plus the theme fonts", () => {
    if (!BASE_DARK) throw new Error("base dark theme missing");
    const missing = Object.keys(BASE_DARK.colors).filter((key) => !(key in INFINITYSCALE_APP_THEME.colors));
    expect(missing).toEqual([]);
    expect(INFINITYSCALE_APP_THEME.colors[THEME_FONT_SANS_VAR]).toContain("Inter");
    expect(INFINITYSCALE_APP_THEME.colors[THEME_FONT_MONO_VAR]).toContain("JetBrains Mono");
    for (const value of Object.values(INFINITYSCALE_APP_THEME.colors)) expect(value.trim()).not.toBe("");
  });

  test("carries the console's contract values exactly", () => {
    expect(INFINITYSCALE_APP_THEME.base).toBe("dark");
    expect(INFINITYSCALE_APP_THEME.colors["--background"]).toBe("#0a0814");
    expect(INFINITYSCALE_APP_THEME.colors["--primary"]).toBe("#6e56cf");
    expect(INFINITYSCALE_APP_THEME.colors["--border"]).toBe("#2e2a3a");
    expect(INFINITYSCALE_APP_THEME.colors["--radius"]).toBe("0.625rem");
    expect(INFINITYSCALE_APP_THEME.colors["--accent"]).toBe(INFINITYSCALE_APP_THEME.colors["--primary"]);
  });

  test("is a built-in app theme with a paired built-in editor theme", () => {
    expect(isKnownAppThemeId(INFINITYSCALE_APP_THEME_ID)).toBe(true);
    expect(isKnownEditorThemeId(INFINITYSCALE_EDITOR_THEME_ID)).toBe(true);
    expect(BUILTIN_EDITOR_THEMES.some((theme) => theme.id === "auto")).toBe(true);
    expect(pairedEditorThemeId(INFINITYSCALE_APP_THEME_ID)).toBe(INFINITYSCALE_EDITOR_THEME_ID);
    expect(pairedEditorThemeId("zinc-dark-white")).toBe("auto");
    expect(isKnownAppThemeId("nope")).toBe(false);
    expect(isKnownEditorThemeId("nope")).toBe(false);
  });

  test("the editor theme paints the editor with the preset's ground, cursor and syntax colours", () => {
    const colors = INFINITYSCALE_EDITOR_THEME.colors ?? {};
    expect(INFINITYSCALE_EDITOR_THEME.base).toBe("vs-dark");
    expect(colors["editor.background"]).toBe(INFINITYSCALE_APP_THEME.colors["--studio-bg"]);
    expect(colors["editor.lineHighlightBackground"]).toBe(INFINITYSCALE_APP_THEME.colors["--muted"]);
    expect(colors["editorCursor.foreground"]).toBe(INFINITYSCALE_APP_THEME.colors["--primary"]);
    expect(colors["editorWidget.background"]).toBe(INFINITYSCALE_APP_THEME.colors["--card"]);
    const tokens = Object.fromEntries((INFINITYSCALE_EDITOR_THEME.rules ?? []).map((rule) => [rule.token, rule.foreground]));
    expect(`#${tokens.keyword}`).toBe(INFINITYSCALE_APP_THEME.colors["--syntax-keyword"]);
    expect(`#${tokens.string}`).toBe(INFINITYSCALE_APP_THEME.colors["--syntax-string"]);
    expect(`#${tokens.number}`).toBe(INFINITYSCALE_APP_THEME.colors["--syntax-number"]);
    expect(`#${tokens.comment}`).toBe(INFINITYSCALE_APP_THEME.colors["--muted-foreground"]);
  });
});

describe("theme selection", () => {
  test("parses only a complete { app, editor } pair", () => {
    expect(parseThemeSelection(SELECTION)).toEqual(SELECTION);
    expect(parseThemeSelection({ app: "x" })).toBeNull();
    expect(parseThemeSelection({ app: "", editor: "y" })).toBeNull();
    expect(parseThemeSelection(null)).toBeNull();
    expect(parseThemeSelection("infinityscale")).toBeNull();
  });

  test("the admin body accepts known ids, pairs the editor, and honours the server default", () => {
    expect(themeOf(sessionBody())).toBeNull();
    expect(themeOf(sessionBody(), SELECTION)).toEqual(SELECTION);
    expect(themeOf(sessionBody({ theme: { app: INFINITYSCALE_APP_THEME_ID } }))).toEqual(SELECTION);
    expect(themeOf(sessionBody({ theme: { app: INFINITYSCALE_APP_THEME_ID, editor: "vs-dark" } }))).toEqual({ app: INFINITYSCALE_APP_THEME_ID, editor: "vs-dark" });
    expect(themeOf(sessionBody({ theme: { app: "zinc-dark-white" } }))).toEqual({ app: "zinc-dark-white", editor: "auto" });
    expect(themeOf(sessionBody({ theme: { editor: "studio-dark" } }), SELECTION)).toEqual({ app: INFINITYSCALE_APP_THEME_ID, editor: "studio-dark" });
    expect(themeOf(sessionBody({ theme: { app: "zinc-dark-white" } }), SELECTION)).toEqual({ app: "zinc-dark-white", editor: "auto" });
  });

  test("the admin body rejects unknown ids and malformed themes", () => {
    expect(themeOf(sessionBody({ theme: { app: "nope" } }))).toBe("invalid_theme");
    expect(themeOf(sessionBody({ theme: { app: INFINITYSCALE_APP_THEME_ID, editor: "nope" } }))).toBe("invalid_theme");
    expect(themeOf(sessionBody({ theme: { editor: "vs-dark" } }))).toBe("invalid_theme");
    expect(themeOf(sessionBody({ theme: "infinityscale" }))).toBe("invalid_theme");
    expect(themeOf(sessionBody({ theme: [] }))).toBe("invalid_theme");
    const failure = parseAdminSessionRequest(sessionBody({ theme: { app: 7 } }));
    expect(failure).toEqual({ ok: false, code: "invalid_theme", field: "theme.app" });
  });

  test("a minted token carries the theme into the claimed session, and none means null", () => {
    const store = createEmbedStore();
    const base = { connectionId: 7, externalId: "u1/d1", userId: "u1", dbId: "d1", displayName: "orders", engine: "postgres" as const, label: "orders", ttlSeconds: 60 };
    const themed = store.claim(store.mintToken({ ...base, theme: SELECTION }).token);
    if ("error" in themed) throw new Error(themed.error);
    expect(themed.session.theme).toEqual(SELECTION);
    const plain = store.claim(store.mintToken(base).token);
    if ("error" in plain) throw new Error(plain.error);
    expect(plain.session.theme).toBeNull();
  });
});
