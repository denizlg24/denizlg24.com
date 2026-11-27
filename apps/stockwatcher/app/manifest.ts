import type { MetadataRoute } from "next";

// iOS before 26 only grants web push to a Home Screen app whose manifest is standalone.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Stockwatcher",
    short_name: "Stockwatcher",
    start_url: "/",
    display: "standalone",
    background_color: "#f5f5ef",
    theme_color: "#174e3a",
    icons: [
      { src: "/apple-icon.png", sizes: "180x180", type: "image/png" },
      { src: "/stockwatcher.svg", sizes: "any", type: "image/svg+xml" },
    ],
  };
}
