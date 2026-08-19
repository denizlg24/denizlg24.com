import type { Viewport } from "next"
import { Geist_Mono, Inter } from "next/font/google"

import "./globals.css"
import { rootMetadata } from "@/app/metadata"
import { AddToHomeScreenPrompt } from "@/components/add-to-home-screen-prompt"
import { ThemeProvider } from "@/components/theme-provider"
import { Toaster } from "@/components/ui/sonner"
import { cn } from "@/lib/utils"

export const metadata = rootMetadata

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
}

const inter = Inter({ subsets: ["latin"], variable: "--font-sans" })

const fontMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
})

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={cn(
        "antialiased",
        inter.variable,
        fontMono.variable,
        "font-sans"
      )}
    >
      <body>
        <ThemeProvider>
          <div className="macros-app-shell">{children}</div>
          <AddToHomeScreenPrompt />
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  )
}
