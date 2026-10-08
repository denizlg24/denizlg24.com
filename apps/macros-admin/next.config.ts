import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  transpilePackages: ["@repo/ui", "@repo/cloud-ui"],
  turbopack: {
    // @denizlg24/auth imports `next/navigation.js` (Node ESM needs the
    // extension). That specifier skips Next's react-server alias, and a route
    // handler then fails to bundle the client router context it pulls in.
    resolveAlias: {
      "next/headers.js": "next/headers",
      "next/navigation.js": "next/navigation",
      "next/server.js": "next/server",
    },
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "no-referrer" },
        ],
      },
    ];
  },
};

export default nextConfig;
