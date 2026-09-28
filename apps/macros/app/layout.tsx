import { cn } from "@repo/ui/utils";
import type { Viewport } from "next";
import { Inter, Nunito } from "next/font/google";

import "./globals.css";
import { rootMetadata } from "@/app/metadata";

export const metadata = rootMetadata;

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  colorScheme: "light dark",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#000000" },
  ],
};

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });

const nunito = Nunito({ subsets: ["latin"], variable: "--font-nunito" });

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={cn(inter.variable, nunito.variable)}>
      <body>
        <a
          href="#main"
          className="sr-only rounded-full bg-foreground px-4 py-2 text-sm font-semibold text-background focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-100"
        >
          Skip to content
        </a>
        {children}
      </body>
    </html>
  );
}
