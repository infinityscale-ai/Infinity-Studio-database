// Serves the exported Next.js SPA from INFSTUDIO_STATIC_DIR, mounted after every API route.
import fs from "fs";
import path from "path";
import type express from "express";
import type { ServerConfig } from "./config";

export type StaticOptions = { staticDir: string; embedOnly: boolean };
export type StaticResolution = { file: string; status: 200 | 404 };

const EMBED_PAGES = new Set(["/embed", "/embed/"]);
const API_BASES = ["/api", "/mcp", "/health"];
const STUDIO_API = /^\/studio\/\d+(\/|$)/;

// Reports whether a request is for a page or asset rather than an API route.
export function isStaticPageRequest(method: string, urlPath: string): boolean {
  if (method !== "GET" && method !== "HEAD") return false;
  if (API_BASES.some((base) => urlPath === base || urlPath.startsWith(`${base}/`))) return false;
  return !STUDIO_API.test(urlPath);
}

// Decodes a URL path, rejecting malformed escapes and NUL bytes.
function decodePath(urlPath: string): string | null {
  try {
    const decoded = decodeURIComponent(urlPath);
    return decoded.includes("\0") ? null : decoded;
  } catch {
    return null;
  }
}

// Reports whether a resolved candidate stays inside the static root.
function isInside(root: string, candidate: string): boolean {
  return candidate === root || candidate.startsWith(root + path.sep);
}

// Reports whether a path names an existing regular file.
function isFile(file: string): boolean {
  try {
    return fs.statSync(file).isFile();
  } catch {
    return false;
  }
}

// Finds the export file for a candidate path: itself, its index.html, or its .html twin.
function findExport(candidate: string): string | null {
  if (isFile(candidate)) return candidate;
  const index = path.join(candidate, "index.html");
  if (isFile(index)) return index;
  const twin = `${candidate}.html`;
  if (isFile(twin)) return twin;
  return null;
}

// Reports whether embed-only serving lets this path resolve to the given file.
function embedAllows(urlPath: string, file: string): boolean {
  if (!file.endsWith(".html")) return true;
  return EMBED_PAGES.has(urlPath) || urlPath.startsWith("/_next/");
}

// Maps a URL path to the exported file that serves it, or the 404 page.
export function resolveStaticFile(urlPath: string, opts: StaticOptions): StaticResolution {
  const root = path.resolve(opts.staticDir);
  const notFound: StaticResolution = { file: path.join(root, "404.html"), status: 404 };
  const decoded = decodePath(urlPath);
  if (decoded === null || !decoded.startsWith("/")) return notFound;
  const trimmed = decoded.length > 1 ? decoded.replace(/\/+$/, "") : decoded;
  const candidate = path.resolve(root, `.${trimmed}`);
  if (!isInside(root, candidate)) return notFound;
  const file = findExport(candidate);
  if (!file || !isInside(root, file)) return notFound;
  if (opts.embedOnly && !embedAllows(decoded, file)) return notFound;
  return { file, status: 200 };
}

// Writes the response headers for a resolved static file.
function setStaticHeaders(res: express.Response, urlPath: string, file: string, frameAncestors: string): void {
  res.setHeader("X-Content-Type-Options", "nosniff");
  if (file.endsWith(".html")) {
    res.setHeader("Content-Security-Policy", `frame-ancestors ${frameAncestors}`);
    res.setHeader("Cache-Control", "no-store");
  } else if (urlPath.startsWith("/_next/static/")) {
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
  }
}

// Registers the catch-all GET/HEAD handler that serves the SPA; a no-op without a static dir.
export function mountStatic(app: express.Express, cfg: ServerConfig): void {
  const staticDir = cfg.staticDir;
  if (!staticDir) return;
  const frameAncestors = ["'self'", ...cfg.embedAllowedOrigins].join(" ");
  app.get("*", (req, res, next) => {
    if (!isStaticPageRequest(req.method, req.path)) return next();
    const resolved = resolveStaticFile(req.path, { staticDir, embedOnly: cfg.embedMode });
    setStaticHeaders(res, req.path, resolved.file, frameAncestors);
    res.status(resolved.status).sendFile(resolved.file, { cacheControl: false, dotfiles: "deny" }, (err) => {
      if (err && !res.headersSent) res.status(404).type("text/plain").send("Not found");
    });
  });
}
