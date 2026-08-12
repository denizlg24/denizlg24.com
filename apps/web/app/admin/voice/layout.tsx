import type { Metadata, Viewport } from "next";
import { forbidden } from "next/navigation";
import { getAdminSession } from "@/lib/require-admin";
import {
  VOICE_APP_NAME,
  VOICE_APP_SCOPE,
  VOICE_APP_THEME_COLOR,
  voiceAppIcons,
} from "./pwa-config";

export const metadata: Metadata = {
  title: "Voice",
  manifest: `${VOICE_APP_SCOPE}/manifest.webmanifest`,
  appleWebApp: {
    capable: true,
    title: VOICE_APP_NAME,
    statusBarStyle: "default",
  },
  icons: {
    apple: [
      { url: voiceAppIcons.appleTouch, sizes: "180x180", type: "image/png" },
    ],
  },
};

export const viewport: Viewport = {
  themeColor: VOICE_APP_THEME_COLOR,
  viewportFit: "cover",
};

export default async function VoiceLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // if (!(await getAdminSession())) forbidden(); the voice ball returns unauthorized when not logged in.
  return children;
}
