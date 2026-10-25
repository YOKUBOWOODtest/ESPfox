/**
 * Standalone Socket.io server.
 *
 * This is the process that runs on a free Node host (alwaysdata) when the
 * frontend is served as a static site from Cloudflare Pages. It carries no
 * Next.js dependency, so it fits comfortably in 256 MB of RAM and a 1 GB disk.
 *
 * Start it with `node server/socket.ts`. The host may provide either `IP` and
 * `PORT` (alwaysdata) or the more common `HOSTNAME` and `PORT`.
 */

import { createServer } from "node:http";
import { attachRealtime } from "./realtime.ts";

const hostname = process.env.IP ?? process.env.HOSTNAME ?? "0.0.0.0";
const port = Number.parseInt(process.env.PORT ?? "3001", 10);

const httpServer = createServer((request, response) => {
  if (request.url === "/health" || request.url === "/") {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ ok: true, service: "whiteboardmod-realtime" }));
    return;
  }

  response.writeHead(404, { "content-type": "text/plain" });
  response.end("Not found");
});

attachRealtime(httpServer);

httpServer.listen(port, hostname, () => {
  console.log(`> whiteboardmod realtime ready on http://${hostname}:${port}`);
});
