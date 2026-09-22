import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import fs from "fs";
import os from "os";
import path from "path";
import { isStaticPageRequest, resolveStaticFile } from "../../server/web/static";

let root = "";

// Lays out a miniature Next.js export: pages, a chunk, an asset, and the 404 page.
function writeExport(dir: string): void {
  const files = [
    "index.html",
    "404.html",
    "studio/index.html",
    "studio/agents/index.html",
    "embed/index.html",
    "_next/static/chunks/app.js",
    "logo.png",
    "docs.html",
  ];
  for (const rel of files) {
    const file = path.join(dir, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, rel);
  }
}

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "infstudio-static-"));
  writeExport(root);
});

afterAll(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

// Resolves against the fixture export in full (non-embed) mode.
function full(urlPath: string) {
  return resolveStaticFile(urlPath, { staticDir: root, embedOnly: false });
}

// Resolves against the fixture export in embed-only mode.
function embed(urlPath: string) {
  return resolveStaticFile(urlPath, { staticDir: root, embedOnly: true });
}

describe("resolveStaticFile", () => {
  test("maps the root and the page directories, with or without a trailing slash", () => {
    expect(full("/")).toEqual({ file: path.join(root, "index.html"), status: 200 });
    expect(full("/studio")).toEqual({ file: path.join(root, "studio/index.html"), status: 200 });
    expect(full("/studio/")).toEqual({ file: path.join(root, "studio/index.html"), status: 200 });
    expect(full("/studio/agents/")).toEqual({ file: path.join(root, "studio/agents/index.html"), status: 200 });
    expect(full("/embed")).toEqual({ file: path.join(root, "embed/index.html"), status: 200 });
  });

  test("serves existing files and .html twins as themselves", () => {
    expect(full("/_next/static/chunks/app.js").file).toBe(path.join(root, "_next/static/chunks/app.js"));
    expect(full("/logo.png").status).toBe(200);
    expect(full("/docs")).toEqual({ file: path.join(root, "docs.html"), status: 200 });
  });

  test("unknown paths get the 404 page with a 404 status", () => {
    expect(full("/nope")).toEqual({ file: path.join(root, "404.html"), status: 404 });
    expect(full("/studio/42/folders").status).toBe(404);
  });

  test("path traversal never escapes the static dir", () => {
    const outside = path.join(path.dirname(root), "escape.txt");
    fs.writeFileSync(outside, "secret");
    try {
      expect(full("/../escape.txt").status).toBe(404);
      expect(full("/%2e%2e/escape.txt").status).toBe(404);
      expect(full("/studio/../../escape.txt").status).toBe(404);
      expect(full("/%00").status).toBe(404);
      expect(full("/%zz").status).toBe(404);
    } finally {
      fs.rmSync(outside, { force: true });
    }
  });

  test("embed-only mode serves the embed page, chunks and assets, and nothing else", () => {
    expect(embed("/embed").status).toBe(200);
    expect(embed("/embed/").status).toBe(200);
    expect(embed("/_next/static/chunks/app.js").status).toBe(200);
    expect(embed("/logo.png").status).toBe(200);
    expect(embed("/").status).toBe(404);
    expect(embed("/studio").status).toBe(404);
    expect(embed("/studio/").status).toBe(404);
    expect(embed("/studio/agents/").status).toBe(404);
    expect(embed("/docs").status).toBe(404);
    expect(embed("/nope").status).toBe(404);
  });
});

describe("isStaticPageRequest", () => {
  test("GET/HEAD page and asset paths are static", () => {
    expect(isStaticPageRequest("GET", "/")).toBe(true);
    expect(isStaticPageRequest("HEAD", "/studio")).toBe(true);
    expect(isStaticPageRequest("GET", "/studio/agents")).toBe(true);
    expect(isStaticPageRequest("GET", "/_next/static/chunks/app.js")).toBe(true);
    expect(isStaticPageRequest("GET", "/embed")).toBe(true);
  });

  test("API routes and non-GET methods are not", () => {
    expect(isStaticPageRequest("POST", "/")).toBe(false);
    expect(isStaticPageRequest("GET", "/api/connections")).toBe(false);
    expect(isStaticPageRequest("GET", "/api")).toBe(false);
    expect(isStaticPageRequest("GET", "/health")).toBe(false);
    expect(isStaticPageRequest("GET", "/mcp")).toBe(false);
    expect(isStaticPageRequest("GET", "/studio/42/folders")).toBe(false);
    expect(isStaticPageRequest("GET", "/studio/42")).toBe(false);
  });
});
