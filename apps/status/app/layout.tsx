import type { Metadata, Viewport } from "next";
import { Geist } from "next/font/google";
import { Footer, Header } from "@/components/shell";
import "./globals.css";

const geist = Geist({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-geist",
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
    <html lang="en" className={geist.variable} suppressHydrationWarning>
      <body>
        <script dangerouslySetInnerHTML={{ __html: theme }} />
        <a className="skip-link" href="#main">
          Skip to content
        </a>
        <div className="site-wrap">
          <Header />
          <main id="main">{children}</main>
          <Footer />
        </div>
      </body>
    </html>
  );
}
