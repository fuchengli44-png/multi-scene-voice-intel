import http from "node:http";
import { networkInterfaces } from "node:os";

const PORT = Number(process.env.PHONE_CHECK_PORT || 8090);
const HOST = process.env.HOST || "0.0.0.0";

const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Phone connection check</title>
    <style>
      body { margin: 0; font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #f6f8fb; color: #17202a; }
      main { max-width: 680px; margin: 0 auto; padding: 28px 18px; }
      .panel { background: #fff; border: 1px solid #dde4ee; border-radius: 10px; padding: 20px; box-shadow: 0 10px 30px rgba(20, 30, 50, 0.08); }
      h1 { font-size: 24px; margin: 0 0 12px; }
      p { line-height: 1.65; }
      code { background: #edf2f7; border-radius: 5px; padding: 2px 6px; }
      .ok { color: #0a7f45; font-weight: 700; }
    </style>
  </head>
  <body>
    <main>
      <section class="panel">
        <h1>Phone connection check</h1>
        <p class="ok">If this page opens on your phone, the phone can reach this computer on the LAN.</p>
        <p>Next, open the app: <code>http://current-computer-ip:8081</code></p>
        <p>Proxy health check: <code>http://current-computer-ip:8787/health</code></p>
      </section>
    </main>
  </body>
</html>`;

const server = http.createServer((req, res) => {
  if (req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(html);
});

server.listen(PORT, HOST, () => {
  console.log(`Phone check listening on http://${HOST}:${PORT}`);
  for (const address of getLanAddresses()) {
    console.log(`Phone check URL: http://${address}:${PORT}`);
  }
});

function getLanAddresses() {
  return Object.values(networkInterfaces())
    .flatMap((items) => items ?? [])
    .filter((item) => item.family === "IPv4" && !item.internal)
    .map((item) => item.address);
}
