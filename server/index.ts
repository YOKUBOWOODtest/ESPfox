/**
 * Production server for Render (and local development).
 *
 * Serves the Next.js app and the Socket.io endpoint from the same port. The
 * realtime logic lives in `realtime.ts` so the same backend can also run as a
 * tiny standalone process on a free Node host (see `socket.ts`).
 *
 * Runs directly with `node server/index.ts`: the server only uses erasable
 * TypeScript syntax, which Node 24 strips natively.
 */

import { createServer } from "node:http";
import { parse } from "node:url";
import next from "next";
import { attachRealtime } from "./realtime.ts";

const dev = process.env.NODE_ENV !== "production";
const hostname = process.env.HOSTNAME ?? "0.0.0.0";
const port = Number.parseInt(process.env.PORT ?? "3000", 10);

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

app.prepare().then(() => {
  const httpServer = createServer((request, response) => {
    const parsed = parse(request.url ?? "/", true);
    handle(request, response, parsed).catch((error: unknown) => {
      console.error("[server] request failed", error);
      if (!response.headersSent) {
        response.statusCode = 500;
        response.end("Internal Server Error");
      }
    });
  });

  attachRealtime(httpServer);

  httpServer.listen(port, hostname, () => {
    console.log(
      `> whiteboardmod ready on http://${hostname}:${port} (${dev ? "dev" : "production"})`,
    );
  });
});
