import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  transpilePackages: ["@repo/ui", "@repo/cloud-ui"],
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          // The consent page grants an MCP client superuser tokens with one
          // click; framing it is the classic way to get that click.
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
