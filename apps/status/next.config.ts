import type { NextConfig } from "next";

const config: NextConfig = {
  output: "standalone",
  cacheComponents: true,
  poweredByHeader: false,
  serverExternalPackages: ["mongodb"],
  turbopack: {
    // @denizlg24/auth imports `next/navigation.js` (Node ESM needs the
    // extension), which skips Next's react-server alias.
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
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "DENY" },
        ],
      },
    ];
  },
};
export default config;
