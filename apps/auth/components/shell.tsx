"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { SessionGate, useSessionUser } from "./session-gate";

function Header() {
  const user = useSessionUser();
  return (
    <header className="flex h-12 items-center justify-between border-b px-4 text-xs">
      <Link href="/" className="text-sm font-semibold tracking-tight">
        deniz<span className="text-muted-foreground">auth</span>
      </Link>
      <div className="flex items-center gap-3">
        <span className="text-muted-foreground">{user.username}</span>
        <Link href="/logout" className="hover:text-foreground">
          sign out
        </Link>
      </div>
    </header>
  );
}

export function Shell({ children }: { children: ReactNode }) {
  return (
    <SessionGate>
      <div className="flex min-h-dvh flex-col">
        <Header />
        <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8">
          {children}
        </main>
      </div>
    </SessionGate>
  );
}
