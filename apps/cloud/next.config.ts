import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  crossOrigin: "anonymous",
  transpilePackages: ["@repo/ui", "@repo/cloud-ui"],
  // Deployables live in Forge now. Anything still pointing at a project route
  // here lands on the host overview rather than a 404.
  async redirects() {
    return [
      {
        source: "/deployments/:path*",
        destination: "/",
        permanent: false,
      },
      {
        source: "/projects/:path*",
        destination: "/",
        permanent: false,
      },
      // `/databases` narrowed to `/engines`: the per-database create, drop and
      // credentials went to Forge with the resource model.
      {
        source: "/databases/:path*",
        destination: "/engines",
        permanent: false,
      },
    ];
  },
};

export default nextConfig;
