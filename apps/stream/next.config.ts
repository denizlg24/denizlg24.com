import type { NextConfig } from "next";

// Open tabs compare this with `/api/public/version` and reload after a deploy.
const buildVersion =
  process.env.SOURCE_COMMIT ||
  process.env.GIT_COMMIT_SHA ||
  process.env.GITHUB_SHA ||
  String(Date.now());

const nextConfig: NextConfig = {
  output: "standalone",
  env: { NEXT_PUBLIC_STREAM_BUILD: buildVersion },
  poweredByHeader: false,
  transpilePackages: ["@repo/stream-player"],
  images: {
    remotePatterns: [{ protocol: "https", hostname: "image.tmdb.org" }],
  },
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
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        ],
      },
    ];
  },
};

export default nextConfig;
