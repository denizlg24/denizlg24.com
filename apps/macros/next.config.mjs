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
        source: "/register/complete",
        destination: "/register/verified",
        permanent: false,
      },
    ];
  },
};

export default nextConfig;
