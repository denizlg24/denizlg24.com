import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  reactCompiler: true,
  transpilePackages: ["@repo/schemas", "@repo/utils"],
  output: "export",
  images: {
    unoptimized: true,
  },
};

export default nextConfig;
