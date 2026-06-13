import { Kbd, KbdGroup } from "@repo/ui/kbd";
import { PageHeader } from "@repo/ui/page-header";
import { LayoutDashboard } from "lucide-react";
import type { Metadata } from "next";
import { forbidden } from "next/navigation";
import { AppSidebar } from "@/components/app-sidebar";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { getAdminSession } from "@/lib/require-admin";

export const metadata: Metadata = {
  title: "Dashboard",
  manifest: "/admin/dashboard/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "Deniz Dashboard",
    statusBarStyle: "default",
  },
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const session = await getAdminSession();

  if (!session) {
    forbidden();
  }

  return (
    <SidebarProvider>
      <AppSidebar />
      <main className="-mt-26 flex min-h-[calc(100dvh-1.75rem)] min-w-0 w-full flex-col overflow-hidden">
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
        <section className="min-h-0 w-full flex-1 overflow-y-auto overflow-x-hidden px-3 pt-4 pb-6 sm:px-4">
          {children}
        </section>
      </main>
    </SidebarProvider>
  );
}
