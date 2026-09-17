"use client";

import { BrandMark, Wordmark } from "@repo/auth-ui/brand";
import { ThemeToggle } from "@repo/cloud-ui/theme";
import type { SafeUser } from "@repo/schemas/cloud";
import { Avatar, AvatarFallback } from "@repo/ui/avatar";
import { Button } from "@repo/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@repo/ui/dropdown-menu";
import { Skeleton } from "@repo/ui/skeleton";
import { cn } from "@repo/ui/utils";
import { ChevronDown, LogOut } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

const NAV = [
  { href: "/", label: "Account" },
  { href: "/security", label: "Security" },
  { href: "/clients", label: "Clients" },
] as const;

function isActive(pathname: string, href: string): boolean {
  return href === "/" ? pathname === "/" : pathname.startsWith(href);
}

function NavLinks({ className }: { className?: string }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Sections" className={cn("flex items-center", className)}>
      {NAV.map((item) => {
        const active = isActive(pathname, item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "rounded-md px-2.5 py-1.5 text-sm whitespace-nowrap outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50",
              active
                ? "bg-surface font-medium text-accent-strong"
                : "text-muted-foreground hover:text-accent-strong",
            )}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

function UserMenu({ user }: { user: SafeUser }) {
  const initial = user.username.slice(0, 1).toUpperCase();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="gap-2 px-1.5"
          aria-label={`Account menu for ${user.username}`}
        >
          <Avatar size="sm">
            <AvatarFallback className="bg-surface text-accent-strong">
              {initial}
            </AvatarFallback>
          </Avatar>
          <span className="hidden text-sm sm:inline">{user.username}</span>
          <ChevronDown className="size-3.5 text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="flex flex-col gap-0.5 font-normal">
          <span className="text-sm text-accent-strong">{user.username}</span>
          {user.email ? (
            <span className="truncate text-xs text-muted-foreground">
              {user.email}
            </span>
          ) : null}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <a href="/logout">
            <LogOut />
            Sign out
          </a>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * The management shell: strip with brand, section nav, theme and account
 * menu; content in a column of at most 64rem. `user` is null while the
 * session is still being checked, which draws the strip without the menu.
 */
export function ShellFrame({
  user,
  children,
}: {
  user: SafeUser | null;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="border-b">
        <div className="mx-auto flex h-14 w-full max-w-5xl items-center gap-6 px-5 sm:px-8">
          <Link
            href="/"
            className="inline-flex items-center gap-2 rounded-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
          >
            <BrandMark />
            <Wordmark />
          </Link>
          <NavLinks className="hidden gap-1 sm:flex" />
          <div className="ml-auto flex items-center gap-1">
            <ThemeToggle />
            {user ? (
              <UserMenu user={user} />
            ) : (
              <Skeleton className="h-8 w-24" />
            )}
          </div>
        </div>
        <div className="mx-auto w-full max-w-5xl overflow-x-auto px-5 pb-2 sm:hidden">
          <NavLinks className="gap-1" />
        </div>
      </header>
      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-8 px-5 py-8 sm:px-8 sm:py-10">
        {children}
      </main>
    </div>
  );
}

/** Title, one line on what the page is for, and the page-level actions. */
export function PageIntro({
  title,
  description,
  actions,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3 border-b pb-5">
      <div className="flex min-w-0 flex-col gap-1">
        <h1 className="text-xl font-semibold tracking-tight text-accent-strong">
          {title}
        </h1>
        {description ? (
          <p className="text-sm text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {actions ? (
        <div className="flex items-center gap-2">{actions}</div>
      ) : null}
    </div>
  );
}

/** A titled block on a page: heading with an optional count and actions over a hairline. */
export function PageSection({
  id,
  title,
  count,
  actions,
  children,
}: {
  id?: string;
  title: string;
  count?: number;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section id={id} className="flex scroll-mt-20 flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b pb-2">
        <h2 className="text-sm font-semibold text-accent-strong">
          {title}
          {count !== undefined ? (
            <span className="ml-2 font-normal text-muted-foreground tabular-nums">
              {count}
            </span>
          ) : null}
        </h2>
        {actions ? (
          <div className="flex items-center gap-2">{actions}</div>
        ) : null}
      </div>
      {children}
    </section>
  );
}

/** What a section is for and its one action, shown when it has nothing else. */
export function SectionEmpty({
  children,
  action,
}: {
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-start gap-3 py-2 text-sm text-muted-foreground">
      <p className="max-w-prose">{children}</p>
      {action}
    </div>
  );
}

export function PageSkeleton() {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label="Loading"
      className="flex flex-col gap-8"
    >
      <div className="flex flex-col gap-2 border-b pb-5">
        <Skeleton className="h-7 w-40" />
        <Skeleton className="h-4 w-72" />
      </div>
      <div className="flex flex-col gap-4">
        <Skeleton className="h-5 w-32" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-2/3" />
      </div>
    </div>
  );
}
