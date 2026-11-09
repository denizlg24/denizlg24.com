import type { Metadata, Viewport } from "next";
import { Atkinson_Hyperlegible_Next, Big_Shoulders } from "next/font/google";

import { MyListProvider } from "@/components/my-list";
import { SpatialNav } from "@/components/spatial-nav";
import { VersionWatch } from "@/components/version-watch";
import {
  currentViewer,
  savedTitleIds,
  wantsLargeText,
} from "@/lib/current-viewer";
import { isTv } from "@/lib/viewer";
import "./globals.css";

const display = Big_Shoulders({
  variable: "--font-big-shoulders",
  subsets: ["latin", "latin-ext"],
  axes: ["opsz"],
});
const text = Atkinson_Hyperlegible_Next({
  variable: "--font-atkinson",
  subsets: ["latin", "latin-ext"],
});

export const metadata: Metadata = {
  title: { default: "Stream", template: "%s · Stream" },
  applicationName: "Stream",
  metadataBase: new URL(
    process.env.STREAM_URL ?? "https://stream.denizlg24.com",
  ),
  description:
    "Your family’s films, series, shared profiles and personal picks.",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Stream",
  },
  openGraph: {
    title: "Stream",
    description: "Films and series for the family",
    type: "website",
    siteName: "Stream",
  },
  twitter: {
    card: "summary_large_image",
    title: "Stream",
    description: "Films and series for the family",
  },
  robots: { index: false, follow: false, nocache: true },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#0c0b0a",
  colorScheme: "dark",
};

export default async function RootLayout({
  children,
  modal,
}: {
  children: React.ReactNode;
  modal: React.ReactNode;
}) {
  const [tv, viewer] = await Promise.all([isTv(), currentViewer()]);
  const saved = viewer ? await savedTitleIds(viewer) : [];
  const large = viewer ? wantsLargeText(viewer.audience) : false;
  return (
    <html
      lang="en"
      data-tv={tv ? "" : undefined}
      data-large={large ? "" : undefined}
      className={`${display.variable} ${text.variable} h-full bg-ink text-paper antialiased`}
    >
      <body className="min-h-full">
        <SpatialNav tv={tv} />
        <MyListProvider initial={saved}>
          <div id="page">{children}</div>
          {modal}
        </MyListProvider>
        <VersionWatch />
      </body>
    </html>
  );
}
