import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  crossOrigin: "anonymous",
  transpilePackages: ["@repo/schemas", "@repo/ui"],
};

export default nextConfig;
