import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  crossOrigin: "anonymous",
  transpilePackages: ["@repo/ui", "@repo/cloud-ui"],
};

export default nextConfig;
