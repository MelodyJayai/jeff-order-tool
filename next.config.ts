import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // Preview builds use a separate output directory so building a candidate
  // cannot replace the artifacts used by a source checkout's production
  // process. The default remains `.next` for all existing workflows.
  ...(process.env.JEFF_NEXT_DIST_DIR?.trim()
    ? { distDir: process.env.JEFF_NEXT_DIST_DIR.trim() }
    : {}),
  serverExternalPackages: ["better-sqlite3"],
  experimental: {
    serverActions: {
      bodySizeLimit: "100mb",
    },
  },
};

export default nextConfig;
