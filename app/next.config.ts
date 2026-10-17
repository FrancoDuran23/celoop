import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Native and wasm packages used by the invoice reader load files from node_modules at runtime.
  serverExternalPackages: ["pdfjs-dist", "zxing-wasm", "sharp", "@napi-rs/canvas", "@electric-sql/pglite"],
  async rewrites() {
    return [
      { source: "/agent.json", destination: "/api/agent-card" },
      { source: "/auditor.json", destination: "/api/auditor-card" },
    ];
  },
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
