import type { MetadataRoute } from "next";

const iconSizes = [
  48, 72, 96, 128, 144, 152, 167, 180, 192, 256, 384, 512, 1024,
];
const themeIconSizes = [192, 512, 1024];

const dashboardManifest = {
  id: "/admin/dashboard",
  name: "Deniz Dashboard",
  short_name: "Dashboard",
  description: "Admin dashboard for Deniz Lopes Güneş.",
  start_url: "/admin/dashboard",
  scope: "/admin/dashboard",
  display: "standalone",
  background_color: "#f8fafc",
  theme_color: "#111827",
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
} satisfies MetadataRoute.Manifest;

export function GET() {
  return new Response(JSON.stringify(dashboardManifest), {
    headers: {
      "Content-Type": "application/manifest+json",
    },
  });
}
