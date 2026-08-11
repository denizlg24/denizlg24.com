"use client";

import { ThemeToggle } from "@repo/cloud-ui/theme";
import { UnreachableBanner } from "@repo/cloud-ui/unreachable";
import { usePoll } from "@repo/cloud-ui/use-poll";
import { Button } from "@repo/ui/button";
import { cn } from "@repo/ui/utils";
import { LogOut } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { api } from "@/lib/api";
import { useSession } from "./session-provider";

const NAV = [
  { href: "/", label: "overview" },
  { href: "/users", label: "users" },
  { href: "/engines", label: "engines" },
  { href: "/disks", label: "disks" },
  { href: "/storage", label: "storage" },
  { href: "/tasks", label: "tasks" },
  { href: "/activity", label: "activity" },
  { href: "/terminal", label: "terminal" },
  { href: "/settings", label: "settings" },
];

function isActive(pathname: string, href: string): boolean {
  return href === "/" ? pathname === "/" : pathname.startsWith(href);
}

function NavLinks({ className }: { className?: string }) {
  const pathname = usePathname();
  return (
    <nav className={cn("flex items-center gap-4", className)}>
      {NAV.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          className={cn(
            "whitespace-nowrap text-sm transition-colors",
            isActive(pathname, item.href)
              ? "font-medium text-foreground"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {item.label}
        </Link>
      ))}
    </nav>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const { user, signOut } = useSession();
  // The Pi can reboot under a UI that stays served from Vercel. One cheap
  // probe here tells every screen at once, instead of each page guessing from
  // its own failed poll.
  const { unreachable, loading, reload } = usePoll(api.healthz, 30_000);

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-40 border-b bg-background/95 backdrop-blur">
        <div className="flex h-12 items-center gap-6 px-4 md:px-6">
          <Link href="/" className="text-sm font-semibold tracking-tight">
            deniz<span className="text-muted-foreground">cloud</span>
          </Link>
          <NavLinks className="hidden md:flex" />
          <div className="ml-auto flex items-center gap-3">
            <span className="hidden font-mono text-xs text-muted-foreground sm:inline">
              {user.username}
            </span>
            <ThemeToggle />
            <Button
              variant="ghost"
              size="icon"
              aria-label="Sign out"
              className="size-7"
              onClick={() => void signOut()}
            >
              <LogOut className="size-3.5" />
            </Button>
          </div>
        </div>
        <div className="overflow-x-auto border-t px-4 py-2 md:hidden">
          <NavLinks />
        </div>
        {unreachable && (
          <UnreachableBanner retrying={loading} onRetry={() => void reload()} />
        )}
      </header>
      {/* min-h-0 lets flex-1 children shrink below their content height —
          without it the terminal cannot give back space and overflows. */}
      <main className="mx-auto flex w-full min-h-0 max-w-7xl flex-1 flex-col px-4 py-6 md:px-6">
        {children}
      </main>
    </div>
  );
}
