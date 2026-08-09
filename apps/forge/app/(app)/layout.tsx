import type { Metadata } from "next";
import type { ReactNode } from "react";
import { AppShell } from "@/components/app-shell";
import { SessionProvider } from "@/components/session-provider";

export const metadata: Metadata = {
  title: { default: "overview", template: "%s — deniz forge" },
  description: "Forge host, container, image and deployment operations",
};

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <SessionProvider>
      <AppShell>{children}</AppShell>
    </SessionProvider>
  );
}
