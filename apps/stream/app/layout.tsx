import type { Metadata, Viewport } from "next";
import { Atkinson_Hyperlegible_Next, Big_Shoulders } from "next/font/google";

import { SpatialNav } from "@/components/spatial-nav";
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
}: {
  children: React.ReactNode;
}) {
  const tv = await isTv();
  return (
    <html
      lang="en"
      data-tv={tv ? "" : undefined}
      className={`${display.variable} ${text.variable} h-full bg-ink text-paper antialiased`}
    >
      <body className="min-h-full">
        <SpatialNav tv={tv} />
        {children}
      </body>
    </html>
  );
}
