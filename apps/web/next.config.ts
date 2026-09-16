import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
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
    // proxy.ts matches /api/admin, and Next clones a proxied body only up to
    // this size, silently cutting the rest off. At the 10 MB default every
    // voice note over ~27 minutes arrived truncated and failed to parse.
    // VOICE_NOTE_MAX_BYTES plus multipart overhead.
    proxyClientMaxBodySize: "260mb",
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
};

export default nextConfig;
