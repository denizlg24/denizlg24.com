import type { MetadataRoute } from "next";
import {
  VOICE_APP_BACKGROUND_COLOR,
  VOICE_APP_NAME,
  VOICE_APP_SCOPE,
  VOICE_APP_SHORT_NAME,
  VOICE_APP_THEME_COLOR,
  voiceAppIcons,
} from "../pwa-config";

const voiceManifest = {
  id: VOICE_APP_SCOPE,
  name: VOICE_APP_NAME,
  short_name: VOICE_APP_SHORT_NAME,
  description: "Voice assistant for Deniz Lopes Güneş.",
  start_url: VOICE_APP_SCOPE,
  scope: VOICE_APP_SCOPE,
  display: "standalone",
  background_color: VOICE_APP_BACKGROUND_COLOR,
  theme_color: VOICE_APP_THEME_COLOR,
  orientation: "portrait",
  icons: [
    {
      src: voiceAppIcons.any192,
      sizes: "192x192",
      type: "image/png",
      purpose: "any" as const,
    },
    {
      src: voiceAppIcons.any512,
      sizes: "512x512",
      type: "image/png",
      purpose: "any" as const,
    },
    {
      src: voiceAppIcons.maskable192,
      sizes: "192x192",
      type: "image/png",
      purpose: "maskable" as const,
    },
    {
      src: voiceAppIcons.maskable512,
      sizes: "512x512",
      type: "image/png",
      purpose: "maskable" as const,
    },
  ],
} satisfies MetadataRoute.Manifest;

export function GET() {
  return new Response(JSON.stringify(voiceManifest), {
    headers: {
      "Content-Type": "application/manifest+json",
    },
  });
}
