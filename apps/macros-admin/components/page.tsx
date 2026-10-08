import { cn } from "@repo/ui/utils";
import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

export function PageHeader({
  title,
  meta,
  actions,
  back,
  titleClassName,
  bordered = true,
}: {
  title: ReactNode;
  meta?: ReactNode;
  actions?: ReactNode;
  back?: { href: string; label: string };
  titleClassName?: string;
  /** Off when a filter row directly below draws the rule instead. */
  bordered?: boolean;
}) {
  return (
    <header
      className={cn("flex flex-col gap-3", bordered ? "border-b pb-5" : "pb-3")}
    >
      {back ? (
        <Link
          href={back.href}
          className="-ml-1 inline-flex w-fit items-center gap-0.5 rounded-sm text-xs text-muted-foreground outline-none transition-colors hover:text-accent-strong focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          <ChevronLeft className="size-3.5" aria-hidden />
          {back.label}
        </Link>
      ) : null}
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
        <div className="flex min-w-0 flex-col gap-1.5">
          <h1
            className={cn(
              "text-xl font-semibold tracking-tight text-balance break-words text-accent-strong sm:text-2xl",
              titleClassName,
            )}
          >
            {title}
          </h1>
          {meta ? (
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
              {meta}
            </div>
          ) : null}
        </div>
        {actions ? (
          <div className="flex flex-wrap items-center gap-2">{actions}</div>
        ) : null}
      </div>
    </header>
  );
}

export function Section({
  title,
  count,
  actions,
  children,
  className,
}: {
  title: string;
  count?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("flex min-w-0 flex-col gap-3", className)}>
      <div className="flex min-h-7 flex-wrap items-center justify-between gap-2 border-b pb-2">
        <h2 className="text-sm font-semibold text-accent-strong">
          {title}
          {count !== undefined ? (
            <span className="ml-2 font-normal tabular-nums text-muted-foreground">
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

/** Nothing to list: a dash, not a sentence. */
export function Empty({ className }: { className?: string }) {
  return (
    <p className={cn("py-6 text-sm text-muted-foreground", className)}>
      <span aria-hidden>—</span>
      <span className="sr-only">None</span>
    </p>
  );
}

export function Dot() {
  return (
    <span aria-hidden className="text-muted-foreground/60">
      ·
    </span>
  );
}

export interface Stat {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  href?: string;
  emphasis?: "warning";
}

export function StatGrid({
  stats,
  className,
  ruled = true,
}: {
  stats: Stat[];
  className?: string;
  /** Off inside a `Section`, whose own rule already sits above the row. */
  ruled?: boolean;
}) {
  return (
    <dl
      className={cn(
        "grid grid-cols-2 gap-x-6 gap-y-6 sm:grid-cols-4",
        className,
      )}
    >
      {stats.map((stat) => (
        <div
          key={stat.label}
          className={cn(
            "flex min-w-0 flex-col gap-1",
            ruled && "border-t pt-3",
            stat.emphasis === "warning" &&
              "border-t-2 border-status-warning pt-[11px]",
          )}
        >
          <dt className="truncate text-xs text-muted-foreground">
            {stat.label}
          </dt>
          <dd className="text-2xl font-semibold tracking-tight tabular-nums text-accent-strong">
            {stat.href ? (
              <Link
                href={stat.href}
                className="rounded-sm outline-none decoration-1 underline-offset-4 hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50"
              >
                {stat.value}
              </Link>
            ) : (
              stat.value
            )}
          </dd>
          {stat.sub ? (
            <dd className="truncate text-xs text-muted-foreground">
              {stat.sub}
            </dd>
          ) : null}
        </div>
      ))}
    </dl>
  );
}
