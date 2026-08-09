import { ThemeProvider } from "@repo/cloud-ui/theme";
import { themeScript } from "@repo/cloud-ui/theme-script";
import { Toaster } from "@repo/ui/sonner";
import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: { default: "deniz forge", template: "%s — deniz forge" },
  description: "Forge host operations and deployment telemetry",
  applicationName: "deniz forge",
  robots: { index: false, follow: false },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="flex min-h-full flex-col">
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
        <ThemeProvider>{children}</ThemeProvider>
        <Toaster position="bottom-right" />
      </body>
    </html>
  );
}
