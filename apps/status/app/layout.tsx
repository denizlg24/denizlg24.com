import { TooltipProvider } from "@repo/ui/tooltip";
import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Footer, Header } from "@/components/shell";
import "./globals.css";

const geist = Geist({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-geist",
});
const geistMono = Geist_Mono({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-geist-mono",
});
const origin = process.env.STATUS_PUBLIC_URL ?? "https://status.denizlg24.com";
export const metadata: Metadata = {
  metadataBase: new URL(origin),
  title: {
    default: "deniz status — Service health",
    template: "%s — deniz status",
  },
  description: "Service health, uptime history, backups, and incidents.",
  applicationName: "deniz status",
  alternates: { canonical: "/" },
  icons: {
    icon: [
      { url: "/favicon.ico" },
      { url: "/status-icon.png", type: "image/png" },
    ],
    apple: "/status-icon.png",
  },
  openGraph: {
    type: "website",
    siteName: "deniz status",
    locale: "en_GB",
    title: "deniz status",
    description: "Service health, uptime history, backups, and incidents.",
  },
  twitter: { card: "summary_large_image", title: "deniz status" },
  robots: { index: true, follow: true },
};
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f9f8f6" },
    { media: "(prefers-color-scheme: dark)", color: "#303630" },
  ],
  colorScheme: "light dark",
};
const theme = `try{var t=localStorage.getItem('deniz-status-theme');document.documentElement.classList.toggle('dark',t==='dark'||(!t&&matchMedia('(prefers-color-scheme:dark)').matches))}catch{}`;
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      className={`${geist.variable} ${geistMono.variable} h-full`}
      suppressHydrationWarning
    >
      <body className="flex min-h-full flex-col">
        <script dangerouslySetInnerHTML={{ __html: theme }} />
        <a className="skip-link" href="#main">
          Skip to content
        </a>
        <TooltipProvider delayDuration={120}>
          <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-5 sm:px-8">
            <Header />
            <main id="main" className="flex-1 pb-16">
              {children}
            </main>
            <Footer />
          </div>
        </TooltipProvider>
      </body>
    </html>
  );
}
