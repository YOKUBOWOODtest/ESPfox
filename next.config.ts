import type { NextConfig } from "next";

/**
 * Normal deployment (Render, local): the app is served by `server/index.ts`
 * (Next + Socket.io), so no static export.
 *
 * `STATIC_EXPORT=true` (Cloudflare Pages, GitHub Pages) emits a fully static
 * site in `out/`. The realtime socket then points at a separate server through
 * `NEXT_PUBLIC_SOCKET_URL`.
 */
const staticExport = process.env.STATIC_EXPORT === "true";

const nextConfig: NextConfig = staticExport
  ? {
      output: "export",
      trailingSlash: true,
      images: {
        unoptimized: true,
      },
    }
  : {
      // The app is served by `server/index.ts` (Next + Socket.io). Next's docs
      // say standalone output and a custom server cannot be used together.
    };

export default nextConfig;
