import { Skeleton } from "@repo/ui/skeleton";
import { cn } from "@repo/ui/utils";
import { ArrowUpRight } from "lucide-react";
import Link from "next/link";
import { ThemeToggle } from "./live";

const tabs = [
  ["/", "Status"],
  ["/backups", "Backups"],
  ["/maintenance", "Maintenance"],
  ["/incidents", "Incidents"],
] as const;

export function PageNav({ active }: { active: string }) {
  return (
    <nav
      aria-label="Status navigation"
      className="no-scrollbar -mx-1 mb-8 flex items-center gap-1 overflow-x-auto overflow-y-hidden border-b"
    >
      {tabs.map(([href, label]) => (
        <Link
          prefetch={false}
          key={href}
          href={href}
          aria-current={active === href ? "page" : undefined}
          className={cn(
            "-mb-px shrink-0 border-b-2 px-3 py-2.5 text-sm transition-colors",
            active === href
              ? "border-accent-strong text-foreground font-medium"
              : "hover:text-foreground border-transparent text-muted-foreground",
          )}
        >
          {label}
        </Link>
      ))}
    </nav>
  );
}
export function Header() {
  return (
    <header className="flex h-16 items-center justify-between gap-4">
      <Link
        href="/"
        className="flex items-center gap-2.5"
        aria-label="deniz status home"
      >
        <img
          src="/status-icon.png"
          width="28"
          height="28"
          alt=""
          fetchPriority="high"
          className="rounded"
        />
        <span className="text-[15px] tracking-tight">
          <span className="text-foreground font-semibold">deniz</span>
          <span className="text-muted-foreground"> / status</span>
        </span>
      </Link>
      <div className="flex items-center gap-1">
        <ThemeToggle />
        <Link
          prefetch={false}
          href="/admin"
          className="hover:text-foreground flex items-center gap-0.5 rounded-md px-2.5 py-1.5 text-xs text-muted-foreground transition-colors"
        >
          Admin
          <ArrowUpRight aria-hidden className="size-3.5" />
        </Link>
      </div>
    </header>
  );
}
export function Footer() {
  return (
    <footer className="mt-auto flex items-center justify-between gap-4 border-t py-5 text-xs text-muted-foreground">
      <a
        href="https://denizlg24.com"
        className="hover:text-foreground flex items-center gap-0.5 transition-colors"
      >
        denizlg24.com
        <ArrowUpRight aria-hidden className="size-3" />
      </a>
      <span>Daily history in UTC</span>
    </footer>
  );
}
export function Loading() {
  return (
    <div role="status" aria-label="Loading" className="space-y-8">
      <Skeleton className="h-9 w-72" />
      <div className="space-y-6">
        {[0, 1, 2].map((row) => (
          <div key={row} className="space-y-2.5">
            <div className="flex items-center justify-between">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-4 w-24" />
            </div>
            <Skeleton className="h-7 w-full" />
          </div>
        ))}
      </div>
    </div>
  );
}
/** An uppercase label over a hairline — the section rule used across the page. */
export function SectionHeading({
  title,
  note,
  children,
}: {
  title: string;
  note?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <div className="mb-4 flex items-center gap-3">
      <h2 className="text-[11px] font-medium tracking-widest text-muted-foreground uppercase">
        {title}
      </h2>
      <span className="h-px flex-1 bg-border" />
      {note ? (
        <span className="text-xs text-muted-foreground">{note}</span>
      ) : null}
      {children}
    </div>
  );
}
