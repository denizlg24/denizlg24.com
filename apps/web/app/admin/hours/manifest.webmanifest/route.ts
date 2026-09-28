import type { MetadataRoute } from "next";
import {
  HOURS_APP_BACKGROUND_COLOR,
  HOURS_APP_NAME,
  HOURS_APP_SCOPE,
  HOURS_APP_SHORT_NAME,
  HOURS_APP_THEME_COLOR,
  hoursAppIcons,
} from "../pwa-config";

const hoursManifest = {
  id: HOURS_APP_SCOPE,
  name: HOURS_APP_NAME,
  short_name: HOURS_APP_SHORT_NAME,
  description: "Work hours and payouts for Deniz Lopes Güneş.",
  start_url: HOURS_APP_SCOPE,
  scope: HOURS_APP_SCOPE,
  display: "standalone",
  background_color: HOURS_APP_BACKGROUND_COLOR,
  theme_color: HOURS_APP_THEME_COLOR,
  orientation: "portrait",
  categories: ["productivity", "finance"],
  icons: [
    {
      src: hoursAppIcons.any192,
      sizes: "192x192",
      type: "image/png",
      purpose: "any" as const,
    },
    {
      src: hoursAppIcons.any512,
      sizes: "512x512",
      type: "image/png",
      purpose: "any" as const,
    },
    {
      src: hoursAppIcons.maskable192,
      sizes: "192x192",
      type: "image/png",
      purpose: "maskable" as const,
    },
    {
      src: hoursAppIcons.maskable512,
      sizes: "512x512",
      type: "image/png",
      purpose: "maskable" as const,
    },
    {
      src: hoursAppIcons.appleTouch,
      sizes: "180x180",
      type: "image/png",
      purpose: "any" as const,
    },
  ],
  shortcuts: [
    {
      name: "History",
      url: `${HOURS_APP_SCOPE}?tab=history`,
    },
    {
      name: "Pay",
      url: `${HOURS_APP_SCOPE}?tab=pay`,
    },
  ],
} satisfies MetadataRoute.Manifest;

export function GET() {
  return new Response(JSON.stringify(hoursManifest), {
    headers: {
      "Content-Type": "application/manifest+json",
    },
  });
}
