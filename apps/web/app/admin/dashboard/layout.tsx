import { SidebarTrigger } from "@repo/admin/workspace/sidebar-trigger";
import { Button } from "@repo/ui/button";
import { PageHeader } from "@repo/ui/page-header";
import { LayoutDashboard, LogOut } from "lucide-react";
import type { Metadata } from "next";
import { requireAdminPage } from "@/lib/require-admin";
import { CalendarPreloader } from "./_components/calendar-preloader";
import { WebAgentDock } from "./_components/web-agent-dock";
import { WebWorkspaceShell } from "./_components/web-workspace-shell";
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
    <WebWorkspaceShell>
      <CalendarPreloader />
      <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <PageHeader
          icon={<LayoutDashboard className="size-4 text-muted-foreground" />}
          title="Admin"
          leading={<SidebarTrigger />}
        >
          <form action="/auth/logout" method="post">
            <Button
              type="submit"
              variant="ghost"
              size="icon-sm"
              aria-label="Sign out"
              className="text-muted-foreground"
            >
              <LogOut />
            </Button>
          </form>
        </PageHeader>
        <WebAgentDock>
          <section className="h-full min-h-0 w-full overflow-x-hidden px-3 pt-4 pb-6 sm:px-4">
            {children}
          </section>
        </WebAgentDock>
      </main>
    </WebWorkspaceShell>
  );
}
