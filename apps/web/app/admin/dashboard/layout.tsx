import { Kbd, KbdGroup } from "@repo/ui/kbd";
import { PageHeader } from "@repo/ui/page-header";
import { LayoutDashboard } from "lucide-react";
import type { Metadata } from "next";
import { AppSidebar } from "@/components/app-sidebar";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { requireAdminPage } from "@/lib/require-admin";
import { CalendarPreloader } from "./_components/calendar-preloader";
import { WebAgentDock } from "./_components/web-agent-dock";
import { DASHBOARD_APP_SCOPE } from "./pwa-config";

export const metadata: Metadata = {
  title: "Dashboard",
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
        <WebAgentDock>
          <section className="h-full min-h-0 w-full overflow-x-hidden px-3 pt-4 pb-6 sm:px-4">
            {children}
          </section>
        </WebAgentDock>
      </main>
    </SidebarProvider>
  );
}
