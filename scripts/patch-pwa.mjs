import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const root = process.cwd();
const distDir = resolve(root, "dist");
const publicDir = resolve(root, "public");
const indexPath = join(distDir, "index.html");

if (!existsSync(indexPath)) {
  throw new Error("dist/index.html was not found. Run Expo export before patching PWA files.");
}

for (const fileName of ["manifest.webmanifest", "sw.js", "icon.svg"]) {
  const from = join(publicDir, fileName);
  const to = join(distDir, fileName);
  mkdirSync(dirname(to), { recursive: true });
  copyFileSync(from, to);
}

let html = readFileSync(indexPath, "utf8");

if (!html.includes('rel="manifest"')) {
  html = html.replace(
    "</head>",
    `  <link rel="manifest" href="/manifest.webmanifest" />
    <meta name="theme-color" content="#172026" />
    <link rel="icon" href="/icon.svg" />
  </head>`
  );
}

if (!html.includes("navigator.serviceWorker.register")) {
  html = html.replace(
    "</body>",
    `  <script>
      if ("serviceWorker" in navigator) {
        window.addEventListener("load", function () {
          navigator.serviceWorker.register("/sw.js").catch(function () {});
        });
      }
    </script>
  </body>`
  );
}

writeFileSync(indexPath, html);
console.log("PWA files patched into dist/.");
