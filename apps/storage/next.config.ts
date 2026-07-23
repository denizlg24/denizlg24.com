import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  crossOrigin: "anonymous",
  transpilePackages: ["@repo/ui"],
};

export default nextConfig;
