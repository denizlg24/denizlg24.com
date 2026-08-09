import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  crossOrigin: "anonymous",
  transpilePackages: ["@repo/ui", "@repo/cloud-ui"],
  async redirects() {
    return [
      {
        source: "/deployments/:path*",
        destination: "/projects",
        permanent: false,
      },
    ];
  },
};

export default nextConfig;
