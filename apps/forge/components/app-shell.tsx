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

// A project lives at `/<slug>`, one dynamic segment at the root, so every entry
// here is a static segment that a project slug can never take —
// `RESERVED_PROJECT_SLUGS` in @repo/schemas is what keeps that true.
//
// No logs entry. Logs belong to a container or a deployment, and a page that
// listed every log source on the host in one picker made "whose output is this"
// the first question every time. `/[project]/logs` is scoped by its route,
// which is what makes that question unaskable.
//
// `/resources` is top-level rather than only reachable from inside a project
// because a resource with no project is the normal case, not an edge one.
const NAV = [
  { href: "/", label: "projects" },
  { href: "/deployments", label: "deployments" },
  { href: "/resources", label: "resources" },
  { href: "/keys", label: "keys" },
  { href: "/observability", label: "observability" },
];

function NavLinks({ className }: { className?: string }) {
  const pathname = usePathname();
  return (
    <nav className={cn("flex items-center gap-4", className)}>
      {NAV.map((item) => {
        const active =
          item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              "whitespace-nowrap text-sm transition-colors",
              active
                ? "font-medium text-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const { user, signOut } = useSession();
  const { unreachable, loading, reload } = usePoll(api.forge.overview, 30_000);
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-40 border-b bg-background/95 backdrop-blur">
        <div className="flex h-12 items-center gap-6 px-4 md:px-6">
          <Link href="/" className="text-sm font-semibold tracking-tight">
            deniz<span className="text-muted-foreground">forge</span>
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
              className="size-7"
              aria-label="Sign out"
              onClick={() => void signOut()}
            >
              <LogOut className="size-3.5" />
            </Button>
          </div>
        </div>
        <div className="overflow-x-auto border-t px-4 py-2 md:hidden">
          <NavLinks />
        </div>
        {unreachable ? (
          <UnreachableBanner retrying={loading} onRetry={() => void reload()} />
        ) : null}
      </header>
      <main className="mx-auto flex w-full max-w-7xl flex-1 flex-col px-4 py-6 md:px-6">
        {children}
      </main>
    </div>
  );
}
