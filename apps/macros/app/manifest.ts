import type { MetadataRoute } from "next"

const iconSizes = [
  48, 72, 96, 128, 144, 152, 167, 180, 192, 256, 384, 512, 1024,
]
const themeIconSizes = [192, 512, 1024]

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Macros",
    short_name: "Macros",
    description:
      "A mobile-first nutrition tracker for food logs, recipes, micronutrients, weight trends, and energy expenditure.",
    start_url: "/app",
    scope: "/",
    display: "standalone",
    background_color: "#faf9f5",
    theme_color: "#4b5547",
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
  }
}
