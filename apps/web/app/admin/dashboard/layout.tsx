import type { Metadata } from "next";
import { forbidden } from "next/navigation";
import { AppSidebar } from "@/components/app-sidebar";
import { Kbd, KbdGroup } from "@/components/ui/kbd";
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
      <main className="w-full flex flex-col items-center overflow-hidden -mt-22">
        <section className="w-full px-4 mx-auto overflow-hidden">
          <div className="w-full flex flex-row items-center text-xs text-muted-foreground gap-2 pb-4 mb-4 border-b border-b-foreground">
            <SidebarTrigger />
            <KbdGroup>
              <Kbd>Ctrl</Kbd>
              <span>+</span>
              <Kbd>B</Kbd>
            </KbdGroup>
          </div>
          {children}
        </section>
      </main>
    </SidebarProvider>
  );
}
