import type { Metadata } from "next";
import "@fontsource-variable/inter";
import "@fontsource-variable/newsreader";
import "./globals.css";

export const metadata: Metadata = {
  title: "Stockwatcher | Market workspace",
  description:
    "Follow markets, research companies, and keep your investment work in one place.",
  icons: { icon: "/stockwatcher.svg" },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
