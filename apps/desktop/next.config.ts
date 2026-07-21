import type { NextConfig } from "next";

const PRODUCTION_API_BASE_URL = "https://denizlg24.com/api/admin";

const nextConfig: NextConfig = {
  /* config options here */
  env: {
    NEXT_PUBLIC_DESKTOP_API_BASE_URL:
      process.env.NEXT_PUBLIC_DESKTOP_API_BASE_URL ?? PRODUCTION_API_BASE_URL,
  },
  reactCompiler: true,
  transpilePackages: [
    "@repo/admin",
    "@repo/latex-editor",
    "@repo/schemas",
    "@repo/utils",
    "@repo/ui",
  ],
  output: "export",
  images: {
    unoptimized: true,
  },
};

export default nextConfig;
