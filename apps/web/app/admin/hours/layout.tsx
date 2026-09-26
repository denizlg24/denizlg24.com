import type { Metadata, Viewport } from "next";
import { requireAdminPage } from "@/lib/require-admin";
import {
  HOURS_APP_NAME,
  HOURS_APP_SCOPE,
  HOURS_APP_THEME_COLOR,
  hoursAppIcons,
} from "./pwa-config";

export const metadata: Metadata = {
  title: "Hours",
  manifest: `${HOURS_APP_SCOPE}/manifest.webmanifest`,
  appleWebApp: {
    capable: true,
    title: HOURS_APP_NAME,
    statusBarStyle: "default",
  },
  formatDetection: { telephone: false },
  icons: {
    apple: [
      { url: hoursAppIcons.appleTouch, sizes: "180x180", type: "image/png" },
    ],
  },
};

export const viewport: Viewport = {
  themeColor: HOURS_APP_THEME_COLOR,
  viewportFit: "cover",
  width: "device-width",
  initialScale: 1,
  // A tap target app: pinch-zoom only ever happens by accident.
  maximumScale: 1,
  userScalable: false,
};

export default async function HoursLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireAdminPage(HOURS_APP_SCOPE);
  return children;
}
