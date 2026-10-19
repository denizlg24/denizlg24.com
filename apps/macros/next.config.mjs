/** @type {import('next').NextConfig} */
const nextConfig = {
  allowedDevOrigins: ["192.168.1.65"],
  output: "standalone",
  // The web app is gone; home-screen installs and old links still open these.
  async redirects() {
    return [
      { source: "/app", destination: "/", permanent: false },
      { source: "/app/:path*", destination: "/", permanent: false },
      {
        source: "/recipes",
        has: [
          { type: "query", key: "page", value: "(?<page>[2-9]|[1-9]\\d+)" },
        ],
        destination: "/recipes/page/:page",
        permanent: true,
      },
      { source: "/recipes/page/1", destination: "/recipes", permanent: true },
      {
        source: "/register/complete",
        destination: "/register/verified",
        permanent: false,
      },
    ];
  },
};

export default nextConfig;
