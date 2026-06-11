import type { MetadataRoute } from "next";

const iconSizes = [
  48, 72, 96, 128, 144, 152, 167, 180, 192, 256, 384, 512, 1024,
];
const themeIconSizes = [192, 512, 1024];

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Deniz Lopes Güneş Portfolio",
    short_name: "Deniz",
    description:
      "Software engineer from Portugal building modern web applications and digital experiences.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#f1f3e0",
    theme_color: "#204c36",
    orientation: "portrait",
    icons: [
      ...iconSizes.map((size) => ({
        src: `/icon-${size}.png`,
        sizes: `${size}x${size}`,
        type: "image/png",
        purpose: "any" as const,
      })),
      ...iconSizes.map((size) => ({
        src: `/icon-transparent-${size}.png`,
        sizes: `${size}x${size}`,
        type: "image/png",
        purpose: "any" as const,
      })),
      ...themeIconSizes.map((size) => ({
        src: `/icon-maskable-${size}.png`,
        sizes: `${size}x${size}`,
        type: "image/png",
        purpose: "maskable" as const,
      })),
      ...themeIconSizes.map((size) => ({
        src: `/icon-monochrome-${size}.png`,
        sizes: `${size}x${size}`,
        type: "image/png",
        purpose: "monochrome" as const,
      })),
    ],
  };
}
