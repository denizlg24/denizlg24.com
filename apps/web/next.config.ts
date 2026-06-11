import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  crossOrigin: "anonymous",
  reactCompiler: true,
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
  ],
};

export default nextConfig;
