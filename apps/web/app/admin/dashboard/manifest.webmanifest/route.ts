import type { MetadataRoute } from "next";
import {
  DASHBOARD_APP_BACKGROUND_COLOR,
  DASHBOARD_APP_NAME,
  DASHBOARD_APP_SCOPE,
  DASHBOARD_APP_SHORT_NAME,
  DASHBOARD_APP_THEME_COLOR,
} from "../pwa-config";

const iconSizes = [
  48, 72, 96, 128, 144, 152, 167, 180, 192, 256, 384, 512, 1024,
];
const themeIconSizes = [192, 512, 1024];

const dashboardManifest = {
  id: DASHBOARD_APP_SCOPE,
  name: DASHBOARD_APP_NAME,
  short_name: DASHBOARD_APP_SHORT_NAME,
  description: "Admin dashboard for Deniz Lopes Güneş.",
  start_url: DASHBOARD_APP_SCOPE,
  scope: DASHBOARD_APP_SCOPE,
  display: "standalone",
  background_color: DASHBOARD_APP_BACKGROUND_COLOR,
  theme_color: DASHBOARD_APP_THEME_COLOR,
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
