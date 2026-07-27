import type { Metadata, Viewport } from "next";
import { Calistoga, Geist_Mono, Inter } from "next/font/google";
import type { ReactNode } from "react";
import { ThemeProvider } from "./_components/theme-provider";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

const calistoga = Calistoga({
  subsets: ["latin"],
  variable: "--font-calistoga",
  display: "swap",
  weight: "400",
});

const geistMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-geist-mono",
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL("https://envoy.denizlg24.com"),
  title: {
    default: "Envoy CLI — Git for environment files",
    template: "%s | Envoy CLI",
  },
  description:
    "Encrypted, Git-style version control for environment files. Stage redacted diffs, commit secret history, and grant access per file.",
  applicationName: "Envoy CLI",
  keywords: [
    "envoy",
    "envoy cli",
    ".env",
    "dotenv",
    "environment variables",
    "secrets management",
    "developer tools",
    "cli",
    "open source",
  ],
  authors: [{ name: "Deniz Lopes Güneş", url: "https://denizlg24.com" }],
  creator: "Deniz Lopes Güneş",
  publisher: "Envoy",
  category: "developer tools",
  icons: {
    icon: [
      { url: "/icon.png", sizes: "512x512", type: "image/png" },
      { url: "/favicon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/favicon-16.png", sizes: "16x16", type: "image/png" },
    ],
    shortcut: "/favicon.ico",
    apple: [{ url: "/apple-icon.png", sizes: "180x180", type: "image/png" }],
  },
  manifest: "/manifest.webmanifest",
  openGraph: {
    type: "website",
    siteName: "Envoy CLI",
    title: "Envoy CLI — Git for environment files",
    description:
      "Encrypted commits, redacted diffs, and per-file access for environment files.",
    url: "/",
    images: [
      {
        url: "/og-image.png",
        width: 1200,
        height: 630,
        alt: "Envoy CLI — Git for environment files",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Envoy CLI — Git for environment files",
    description:
      "Encrypted commits, redacted diffs, and per-file access for environment files.",
    images: ["/og-image.png"],
  },
  robots: {
    index: true,
    follow: true,
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f9f8f6" },
    { media: "(prefers-color-scheme: dark)", color: "#303630" },
  ],
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${inter.variable} ${calistoga.variable} ${geistMono.variable} min-h-screen bg-background font-inter text-foreground antialiased`}
      >
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
