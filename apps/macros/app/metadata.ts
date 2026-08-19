import type { Metadata } from "next"

const appName = "Macros"
const defaultDescription =
  "A mobile-first nutrition tracker for food logs, recipes, micronutrients, weight trends, and energy expenditure."
const appleTouchIconSizes = [57, 60, 72, 76, 114, 120, 144, 152, 167, 180, 1024]

export function pageMetadata(
  title: string,
  description = defaultDescription
): Metadata {
  return {
    title,
    description,
    appleWebApp: {
      capable: true,
      statusBarStyle: "default",
      title: appName,
    },
    applicationName: appName,
    formatDetection: {
      telephone: false,
    },
    openGraph: {
      title,
      description,
      siteName: appName,
      type: "website",
    },
    twitter: {
      card: "summary",
      title,
      description,
    },
  }
}

export const rootMetadata: Metadata = {
  ...pageMetadata(appName),
  title: {
    default: appName,
    template: `%s | ${appName}`,
  },
  icons: {
    icon: "/favicon.ico",
    apple: [
      { url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" },
      ...appleTouchIconSizes.map((size) => ({
        url: `/apple-touch-icon-${size}x${size}.png`,
        sizes: `${size}x${size}`,
        type: "image/png",
      })),
      ...appleTouchIconSizes.map((size) => ({
        url: `/apple-touch-icon-transparent-${size}x${size}.png`,
        sizes: `${size}x${size}`,
        type: "image/png",
      })),
    ],
  },
  manifest: "/manifest.webmanifest",
}
