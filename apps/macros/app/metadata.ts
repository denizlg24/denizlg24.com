import type { Metadata } from "next";
import { getPublicAppOrigin } from "@/lib/email";

const appName = "Macros";

/** A segment that sets its own `openGraph` loses the root image file's tags. */
const shareImage = {
  url: "/opengraph-image",
  width: 1200,
  height: 630,
  alt: "Macros — nutrition tracking for iPhone.",
};

const siteDescription =
  "A nutrition tracker for iPhone. Log food in a few taps, follow a weight trend instead of daily noise, and get targets set from what you actually burn.";

export function pageMetadata(
  title: string,
  description = siteDescription,
  path?: string,
): Metadata {
  return {
    title,
    description,
    ...(path ? { alternates: { canonical: path } } : {}),
    openGraph: {
      title,
      description,
      siteName: appName,
      type: "website",
      images: [shareImage],
      ...(path ? { url: path } : {}),
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [shareImage],
    },
  };
}

export const rootMetadata: Metadata = {
  metadataBase: new URL(getPublicAppOrigin()),
  title: {
    default: "Macros — nutrition tracking for iPhone",
    template: `%s · ${appName}`,
  },
  description: siteDescription,
  applicationName: appName,
  formatDetection: {
    telephone: false,
    email: false,
    address: false,
  },
  openGraph: {
    title: "Macros — nutrition tracking for iPhone",
    description: siteDescription,
    siteName: appName,
    type: "website",
    url: "/",
  },
  twitter: {
    card: "summary_large_image",
    title: "Macros — nutrition tracking for iPhone",
    description: siteDescription,
  },
  icons: {
    apple: [
      { url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" },
    ],
  },
};
