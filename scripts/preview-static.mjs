/**
 * Local preview of the static build.
 *
 * Serves `out/` and applies the same `/board/*` rewrite as Cloudflare Pages
 * (`public/_redirects`), so the split frontend + Socket.io setup can be tested
 * without a Cloudflare account.
 *
 *   npm run build:static
 *   npm run start:socket          # terminal 1
 *   npm run preview:static        # terminal 2
 *
 * Set `NEXT_PUBLIC_SOCKET_URL` before `build:static` to point at the socket
 * server (for example `http://localhost:3001`).
 */

import { createServer } from "node:http";
import { createReadStream, existsSync, statSync } from "node:fs";
import path from "node:path";

const root = path.resolve("out");
const port = Number.parseInt(process.env.PORT ?? "3002", 10);

const mime = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".mp4": "video/mp4",
};

function resolveFile(pathname) {
  let file = path.join(root, pathname);
  if (existsSync(file) && statSync(file).isDirectory()) {
    file = path.join(file, "index.html");
  }
  if (!existsSync(file) && !path.extname(file)) {
    const html = `${file}.html`;
    if (existsSync(html)) {
      return html;
    }
    const index = path.join(file, "index.html");
    if (existsSync(index)) {
      return index;
    }
  }
  return file;
}

createServer((request, response) => {
  const url = new URL(request.url ?? "/", `http://${request.headers.host}`);
  let pathname = decodeURIComponent(url.pathname);

  // Mirrors public/_redirects: unknown board ids load the board shell.
  if (
    pathname.startsWith("/board/") &&
    pathname !== "/board/" &&
    !pathname.includes(".") &&
    !existsSync(path.join(root, pathname))
  ) {
    pathname = "/board/index.html";
  }

  const file = resolveFile(pathname);
  if (!file.startsWith(root) || !existsSync(file) || statSync(file).isDirectory()) {
    response.writeHead(404, { "content-type": "text/plain" });
    response.end("Not found");
    return;
  }

  response.writeHead(200, {
    "content-type": mime[path.extname(file)] ?? "application/octet-stream",
  });
  createReadStream(file).pipe(response);
}).listen(port, "0.0.0.0", () => {
  console.log(`static preview on http://localhost:${port}`);
});
