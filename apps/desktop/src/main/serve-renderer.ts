/**
 * Loopback static server for the built renderer. Clerk's cookie session can't
 * exist on a file:// origin (README "Prod caveat"), so packaged builds serve
 * dist/renderer over http://127.0.0.1:<port> instead. The port is FIXED so the
 * origin — and with it Clerk's persisted session — survives restarts; if the
 * port is taken by another process we fall back to an ephemeral one (the app
 * still works, the user just signs in again that launch).
 */

import { createServer, type Server } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize, sep } from "node:path";

export const RENDERER_PORT = 43117;

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".map": "application/json",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
};

let started: Promise<string> | null = null;

/** Start (once) and return the origin, e.g. "http://127.0.0.1:43117". */
export function serveRenderer(rootDir: string, log: (msg: string) => void): Promise<string> {
  started ??= startServer(rootDir, log);
  return started;
}

async function startServer(rootDir: string, log: (msg: string) => void): Promise<string> {
  const root = normalize(rootDir);

  const server = createServer((req, res) => {
    void (async () => {
      const urlPath = decodeURIComponent((req.url ?? "/").split("?")[0]);
      // Resolve inside the renderer dir only; anything escaping it → index.html.
      let filePath = normalize(join(root, urlPath));
      if (!filePath.startsWith(root + sep) && filePath !== root) filePath = join(root, "index.html");
      if (filePath === root || urlPath === "/") filePath = join(root, "index.html");

      try {
        const body = await readFile(filePath);
        res.writeHead(200, {
          "content-type": MIME[extname(filePath).toLowerCase()] ?? "application/octet-stream",
          "cache-control": "no-store",
        });
        res.end(body);
      } catch {
        // SPA fallback: unknown paths get the app shell.
        try {
          const shell = await readFile(join(root, "index.html"));
          res.writeHead(200, { "content-type": MIME[".html"], "cache-control": "no-store" });
          res.end(shell);
        } catch (err) {
          res.writeHead(500, { "content-type": MIME[".txt"] });
          res.end(`renderer not built: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    })();
  });

  const port = await listen(server, RENDERER_PORT).catch(async () => {
    log(`renderer port ${RENDERER_PORT} in use — falling back to an ephemeral port (sign-in won't persist this launch)`);
    return listen(server, 0);
  });

  return `http://127.0.0.1:${port}`;
}

function listen(server: Server, port: number): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      const addr = server.address();
      if (addr && typeof addr === "object") resolve(addr.port);
      else reject(new Error("no server address"));
    });
  });
}
