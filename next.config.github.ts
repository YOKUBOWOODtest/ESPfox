import type { NextConfig } from "next";

/**
 * Config for GitHub Pages static export.
 * Only exports static routes - excludes /board/[id] which needs a server.
 * In App Router, dynamic routes without generateStaticParams are automatically excluded.
 */
const nextConfig: NextConfig = {
  output: "export",
  trailingSlash: true,
  images: {
    unoptimized: true,
  },
  // The export has no Socket.io server; the board remains a local whiteboard.
  env: {
    NEXT_PUBLIC_STATIC_EXPORT: "1",
  },
};

export default nextConfig;