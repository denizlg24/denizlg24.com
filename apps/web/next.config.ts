import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  crossOrigin: "anonymous",
  reactCompiler: true,
  transpilePackages: [
    "@repo/admin",
    "@repo/schemas",
    "@repo/utils",
    "@repo/ui",
  ],
  experimental: {
    authInterrupts: true,
  },
  images: {
    remotePatterns: [
      new URL("https://rose-acceptable-bee-887.mypinata.cloud/**"),
      new URL("https://scontent.cdninstagram.com/**"),
      new URL("https://*.cdninstagram.com/**"),
      {
        protocol: "https",
        hostname: "**",
      },
    ],
  },
  serverExternalPackages: [
    "imapflow",
    "mailparser",
    "pino",
    "thread-stream",
    "pino-pretty",
    "@resvg/resvg-js",
  ],
};

export default nextConfig;
