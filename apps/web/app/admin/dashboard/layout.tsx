import { Kbd, KbdGroup } from "@repo/ui/kbd";
import { PageHeader } from "@repo/ui/page-header";
import { LayoutDashboard } from "lucide-react";
import type { Metadata, Viewport } from "next";
import { AppSidebar } from "@/components/app-sidebar";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { requireAdminPage } from "@/lib/require-admin";
import { CalendarPreloader } from "./_components/calendar-preloader";
import { WebAgentLauncher } from "./_components/web-agent-launcher";
import {
  DASHBOARD_APP_NAME,
  DASHBOARD_APP_SCOPE,
  DASHBOARD_APP_THEME_COLOR,
  dashboardAppIcons,
} from "./pwa-config";

export const metadata: Metadata = {
  title: "Dashboard",
  manifest: `${DASHBOARD_APP_SCOPE}/manifest.webmanifest`,
  appleWebApp: {
    capable: true,
    title: DASHBOARD_APP_NAME,
    statusBarStyle: "default",
  },
  icons: {
    apple: [
      {
        url: dashboardAppIcons.appleTouch,
        sizes: "180x180",
        type: "image/png",
      },
    ],
  },
};

export const viewport: Viewport = {
  themeColor: DASHBOARD_APP_THEME_COLOR,
  viewportFit: "cover",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  await requireAdminPage(DASHBOARD_APP_SCOPE);

  return (
    <SidebarProvider>
      <CalendarPreloader />
      <AppSidebar />
      <WebAgentLauncher />
      <main className="-mt-26 flex min-h-[calc(100dvh-1.75rem)] max-h-screen min-w-0 w-full flex-col overflow-hidden">
        <PageHeader
          icon={<LayoutDashboard className="size-4 text-muted-foreground" />}
          title="Admin"
          leading={<SidebarTrigger />}
        >
          <KbdGroup className="hidden sm:flex">
            <Kbd>Ctrl</Kbd>
            <span>+</span>
            <Kbd>B</Kbd>
          </KbdGroup>
        </PageHeader>
        <section className="min-h-0 w-full flex-1 overflow-x-hidden px-3 pt-4 pb-6 sm:px-4">
          {children}
        </section>
      </main>
    </SidebarProvider>
  );
}
