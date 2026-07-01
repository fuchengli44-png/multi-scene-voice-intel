import http from "node:http";
import { createReadStream, existsSync, statSync } from "node:fs";
import { extname, join, resolve } from "node:path";

const root = resolve(process.cwd(), "dist");
const port = Number(process.env.PORT || 8090);
const host = process.env.HOST || "0.0.0.0";

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ttf": "font/ttf"
};

const server = http.createServer((req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host}`);
  const safePath = decodeURIComponent(url.pathname).replace(/^\/+/, "");
  let filePath = resolve(root, safePath || "index.html");

  if (!filePath.startsWith(root) || !existsSync(filePath) || statSync(filePath).isDirectory()) {
    filePath = join(root, "index.html");
  }

  const ext = extname(filePath);
  res.setHeader("Content-Type", contentTypes[ext] || "application/octet-stream");
  res.setHeader("Cache-Control", ext === ".html" ? "no-cache" : "public, max-age=31536000, immutable");
  createReadStream(filePath).pipe(res);
});

server.listen(port, host, () => {
  console.log(`PWA server listening on http://${host}:${port}`);
});
