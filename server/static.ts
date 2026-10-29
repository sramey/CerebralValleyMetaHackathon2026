// Production HTTP for the single-port server (ADR 0014): serves the built client (dist/) with an SPA
// fallback, plus art generated at runtime (public/art/gen), and /healthz. The WebSocket attaches to
// the same http.Server, so one port works behind an HTTPS/wss reverse proxy.
import { createReadStream, existsSync, statSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { extname, join, normalize, sep } from "node:path";

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webp": "image/webp",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".wav": "audio/wav",
  ".txt": "text/plain; charset=utf-8",
};

export interface StaticOptions {
  distDir: string;
  /** Directory holding art generated at runtime, served at /art/gen/. */
  genArtDir: string;
}

/** Resolve a URL path inside `root`, or null if it escapes it or isn't a file. */
export function resolveInside(root: string, urlPath: string): string | null {
  let decoded: string;
  try { decoded = decodeURIComponent(urlPath); } catch { return null; }
  if (decoded.includes("\0")) return null;
  const file = normalize(join(root, decoded));
  const base = normalize(root);
  if (file !== base && !file.startsWith(base + sep)) return null;
  try { return statSync(file).isFile() ? file : null; } catch { return null; }
}

function send(res: ServerResponse, file: string, cache: string): void {
  res.writeHead(200, {
    "content-type": TYPES[extname(file).toLowerCase()] ?? "application/octet-stream",
    "cache-control": cache,
    "x-content-type-options": "nosniff",
  });
  createReadStream(file).on("error", () => res.destroy()).pipe(res);
}

export function createStaticHandler(opts: StaticOptions) {
  const indexFile = join(opts.distDir, "index.html");
  return (req: IncomingMessage, res: ServerResponse): void => {
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.writeHead(405, { allow: "GET, HEAD" }).end();
      return;
    }
    const path = (req.url ?? "/").split("?")[0];
    if (path === "/healthz") {
      res.writeHead(200, { "content-type": "text/plain" }).end("ok");
      return;
    }
    if (!existsSync(indexFile)) {
      res.writeHead(503, { "content-type": "text/plain" }).end("Client not built. Run: npm run build");
      return;
    }
    if (path.startsWith("/art/gen/")) {
      const f = resolveInside(opts.genArtDir, path.slice("/art/gen/".length));
      if (f) return send(res, f, "public, max-age=86400");
    }
    const file = resolveInside(opts.distDir, path === "/" ? "/index.html" : path);
    if (file) return send(res, file, path.startsWith("/assets/") ? "public, max-age=31536000, immutable" : "no-cache");
    // Unknown paths with an extension are real 404s; everything else is the app (share links use /?w=<id>).
    if (extname(path)) { res.writeHead(404, { "content-type": "text/plain" }).end("not found"); return; }
    send(res, indexFile, "no-cache");
  };
}
