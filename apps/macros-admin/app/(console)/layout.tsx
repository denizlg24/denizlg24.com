import { connection } from "next/server";
import type { ReactNode } from "react";

import { MobileBar, type NavCounts, Sidebar } from "@/components/nav";
import { auth, isOwnerToken } from "@/lib/auth";
import { macrosApi } from "@/lib/macros-api";

async function loadCounts(): Promise<NavCounts | null> {
  const session = await auth.getSession();
  if (!session || !isOwnerToken(session.token)) return null;
  const overview = await macrosApi(session).overview();
  return overview.ok ? { openCases: overview.data.openCases } : null;
}

export default async function ConsoleLayout({
  children,
}: {
  children: ReactNode;
}) {
  // Auth config is read on first use; nothing here may run at build time.
  await connection();
  const counts = loadCounts().catch(() => null);
  const signOutHref = auth.logoutUrl();
  return (
    <div className="min-h-dvh">
      <a
        href="#main"
        className="sr-only z-50 rounded-md bg-background px-3 py-2 text-sm focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:ring-[3px] focus:ring-ring/50"
      >
        Skip to content
      </a>
      <Sidebar counts={counts} signOutHref={signOutHref} />
      <MobileBar counts={counts} signOutHref={signOutHref} />
      <main id="main" className="lg:pl-56">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-10 px-4 pt-6 pb-20 sm:px-6 lg:px-10 lg:pt-10">
          {children}
        </div>
      </main>
    </div>
  );
}
