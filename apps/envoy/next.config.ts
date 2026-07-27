import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  crossOrigin: "anonymous",
  transpilePackages: ["@repo/schemas", "@repo/ui"],
};

export default nextConfig;
