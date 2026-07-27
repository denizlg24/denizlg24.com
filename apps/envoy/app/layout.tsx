import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono, Inter } from "next/font/google";
import "./globals.css";
import { ThemeProvider } from "./_components/theme-provider";
import { PixelBlast } from "@/components/PixelBlast";

const inter = Inter({ subsets: ["latin"], variable: "--font-sans" });

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL("https://envoy.denizlg24.com"),
  title: {
    default: "Envoy CLI — .env versioning made easy",
    template: "%s | Envoy CLI",
  },
  description:
    "Envoy is an open-source CLI that brings Git-style version control to your .env files. Track, sync, and share environment variables across machines and teammates without leaking secrets.",
  applicationName: "Envoy CLI",
  keywords: [
    "envoy",
    "envoy cli",
    ".env",
    "dotenv",
    "env versioning",
    "environment variables",
    "secrets management",
    "developer tools",
    "cli",
    "open source",
  ],
  authors: [{ name: "denizlg24", url: "https://github.com/denizlg24" }],
  creator: "denizlg24",
  publisher: "Envoy",
  category: "developer tools",
  icons: {
    icon: [
      { url: "/icon.svg", type: "image/svg+xml" },
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
    title: "Envoy CLI — .env versioning made easy",
    description:
      "Git-style version control for your .env files. Track, sync, and share environment variables safely across machines and teams.",
    url: "/",
    images: [
      {
        url: "/og-image.png",
        width: 1200,
        height: 630,
        alt: "Envoy CLI — .env versioning made easy",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Envoy CLI — .env versioning made easy",
    description:
      "Git-style version control for your .env files. Track, sync, and share environment variables safely.",
    images: ["/og-image.png"],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-image-preview": "large",
      "max-snippet": -1,
    },
  },
  formatDetection: {
    email: false,
    address: false,
    telephone: false,
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#1b9388" },
    { media: "(prefers-color-scheme: dark)", color: "#1db6a5" },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={inter.variable} suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased min-h-screen w-full relative`}
      >
        <ThemeProvider
          attribute="class"
          defaultTheme="dark"
          disableTransitionOnChange
        >
          <div className="w-full h-full absolute -z-10 hidden dark:block opacity-25">
            <PixelBlast
              variant="circle"
              pixelSize={4}
              color={"#1db6a5"}
              patternScale={5}
              patternDensity={1.5}
              pixelSizeJitter={5}
              speed={0.5}
              edgeFade={0.8}
              enableRipples={true}
              transparent
            />
          </div>
          <div className="w-full h-full absolute -z-10 dark:hidden block opacity-25">
            <PixelBlast
              variant="circle"
              pixelSize={4}
              color={"#1b9388"}
              patternScale={5}
              patternDensity={1.5}
              pixelSizeJitter={5}
              speed={0.5}
              edgeFade={0.8}
              enableRipples={true}
              transparent
            />
          </div>
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
