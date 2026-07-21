import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  crossOrigin: "anonymous",
  reactCompiler: true,
  transpilePackages: [
    "@repo/admin",
    "@repo/latex-editor",
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
    "node-latex-compiler",
    "imapflow",
    "mailparser",
    "pino",
    "thread-stream",
    "pino-pretty",
    "@resvg/resvg-js",
  ],
  outputFileTracingIncludes: {
    "/api/admin/cv/compile": [
      "./node_modules/@node-latex-compiler/bin-linux-x64/bin/tectonic",
    ],
  },
};

export default nextConfig;
