import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Envoy CLI",
    short_name: "Envoy",
    description:
      "Git-style version control for your .env files. Track, sync, and share environment variables safely across machines and teams.",
    start_url: "/",
    display: "standalone",
    background_color: "#f1f3e0",
    theme_color: "#204d37",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      {
        src: "/icon-512-maskable.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
