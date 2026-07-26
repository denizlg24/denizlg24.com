import type { Metadata } from "next";
import type { ReactNode } from "react";
import { AppShell } from "@/components/app-shell";
import { SessionProvider } from "@/components/session-provider";

// `default` is also the title for `/`, which has no layout of its own. The
// template has to be restated here: a segment that sets a title without one
// leaves its descendants with no template at all.
export const metadata: Metadata = {
  title: { default: "overview", template: "%s — deniz cloud" },
  description: "host metrics, disks, services and alerts",
};

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <SessionProvider>
      <AppShell>{children}</AppShell>
    </SessionProvider>
  );
}
