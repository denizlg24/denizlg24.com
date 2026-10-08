"use client";

import { ThemeToggle } from "@repo/cloud-ui/theme";
import { Button } from "@repo/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@repo/ui/sheet";
import { cn } from "@repo/ui/utils";
import {
  Flag,
  Gauge,
  LogOut,
  Menu,
  ScanBarcode,
  ScrollText,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Suspense, use, useState } from "react";

import { Wordmark } from "@/components/wordmark";

export interface NavCounts {
  openCases: number;
}

type CountsPromise = Promise<NavCounts | null>;

const NAV_ITEMS = [
  { href: "/", label: "Overview", icon: Gauge },
  { href: "/reports", label: "Reports", icon: Flag },
  { href: "/contributions", label: "Contributions", icon: ScanBarcode },
  { href: "/audit", label: "Audit log", icon: ScrollText },
] as const;

function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

function OpenCount({ counts }: { counts: CountsPromise }) {
  const openCases = use(counts)?.openCases ?? 0;
  if (openCases === 0) return null;
  return (
    <span className="text-xs tabular-nums text-accent-strong">
      {openCases}
      <span className="sr-only"> open</span>
    </span>
  );
}

function NavLinks({
  counts,
  onNavigate,
  dense,
}: {
  counts: CountsPromise;
  onNavigate?: () => void;
  dense?: boolean;
}) {
  const pathname = usePathname();
  return (
    <nav aria-label="Sections">
      <ul className="flex flex-col gap-0.5">
        {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
          const active = isActive(pathname, href);
          return (
            <li key={href}>
              <Link
                href={href}
                onClick={onNavigate}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex items-center gap-3 rounded-md px-2.5 text-sm outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50",
                  dense ? "h-8" : "h-11",
                  active
                    ? "bg-surface font-medium text-accent-strong"
                    : "text-muted-foreground hover:text-accent-strong",
                )}
              >
                <Icon className="size-4 shrink-0" aria-hidden />
                <span className="flex-1 truncate">{label}</span>
                {href === "/reports" ? (
                  <Suspense fallback={null}>
                    <OpenCount counts={counts} />
                  </Suspense>
                ) : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

function SignOutLink({
  href,
  className,
}: {
  href: string;
  className?: string;
}) {
  return (
    <a
      href={href}
      className={cn(
        "flex items-center gap-3 rounded-md px-2.5 text-sm text-muted-foreground outline-none transition-colors hover:text-accent-strong focus-visible:ring-[3px] focus-visible:ring-ring/50",
        className,
      )}
    >
      <LogOut className="size-4 shrink-0" aria-hidden />
      Sign out
    </a>
  );
}

export function Sidebar({
  counts,
  signOutHref,
}: {
  counts: CountsPromise;
  signOutHref: string;
}) {
  return (
    <aside className="fixed inset-y-0 left-0 z-30 hidden w-56 flex-col border-r bg-background lg:flex">
      <div className="flex h-16 items-center px-5">
        <Link
          href="/"
          className="rounded-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          <Wordmark />
        </Link>
      </div>
      <div className="flex-1 overflow-y-auto px-3 py-2">
        <NavLinks counts={counts} dense />
      </div>
      <div className="flex items-center justify-between gap-2 border-t px-3 py-3">
        <SignOutLink href={signOutHref} className="h-8" />
        <ThemeToggle />
      </div>
    </aside>
  );
}

export function MobileBar({
  counts,
  signOutHref,
}: {
  counts: CountsPromise;
  signOutHref: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <header className="sticky top-0 z-30 border-b bg-background/85 pt-[env(safe-area-inset-top)] backdrop-blur-xl backdrop-saturate-150 lg:hidden">
      <div className="flex h-12 items-center gap-2 px-4 sm:px-6">
        <Link
          href="/"
          className="mr-auto rounded-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          <Wordmark />
        </Link>
        <Suspense fallback={null}>
          <OpenCasesShortcut counts={counts} />
        </Suspense>
        <ThemeToggle />
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="size-9 -mr-2"
              aria-label="Menu"
            >
              <Menu className="size-4" />
            </Button>
          </SheetTrigger>
          <SheetContent
            side="right"
            className="w-[min(20rem,85vw)] gap-0 pb-[env(safe-area-inset-bottom)]"
          >
            <SheetHeader className="h-12 justify-center border-b px-4 py-0">
              <SheetTitle className="text-sm">Sections</SheetTitle>
            </SheetHeader>
            <div className="flex-1 overflow-y-auto px-2 py-3">
              <NavLinks counts={counts} onNavigate={() => setOpen(false)} />
            </div>
            <div className="border-t px-2 py-2">
              <SignOutLink href={signOutHref} className="h-11" />
            </div>
          </SheetContent>
        </Sheet>
      </div>
    </header>
  );
}

function OpenCasesShortcut({ counts }: { counts: CountsPromise }) {
  const count = use(counts)?.openCases ?? 0;
  if (count === 0) return null;
  return (
    <Link
      href="/reports"
      className="inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-xs tabular-nums text-accent-strong outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
      aria-label={`${count} open report cases`}
    >
      <span className="size-1.5 rounded-full bg-status-warning" aria-hidden />
      {count}
    </Link>
  );
}
