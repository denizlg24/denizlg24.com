import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Envoy CLI",
    short_name: "Envoy",
    description:
      "Git-style version control for your .env files. Track, sync, and share environment variables safely across machines and teams.",
    start_url: "/",
    display: "standalone",
    background_color: "#0b1411",
    theme_color: "#1db6a5",
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml" },
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
