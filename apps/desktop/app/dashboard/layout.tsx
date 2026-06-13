import { DashboardShell } from "@/components/navigation/dashboard-shell";

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <main className="pt-8 h-screen flex flex-col overflow-hidden">
      <DashboardShell>{children}</DashboardShell>
    </main>
  );
}
