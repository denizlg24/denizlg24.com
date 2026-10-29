import type { ReactNode } from "react";
import { cn } from "./utils";

/** The house section header: a small uppercase label running into a hairline. */
export function SectionLabel({
  children,
  count,
  actions,
  className,
}: {
  children: ReactNode;
  count?: number | string;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex min-h-6 items-center gap-3", className)}>
      <h2 className="shrink-0 text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
        {children}
        {count !== undefined ? (
          <span className="ml-1.5 tabular-nums text-muted-foreground/70">
            {count}
          </span>
        ) : null}
      </h2>
      <div className="h-px flex-1 bg-border" />
      {actions ? (
        <div className="flex shrink-0 items-center gap-1">{actions}</div>
      ) : null}
    </div>
  );
}

export function Section({
  title,
  count,
  actions,
  className,
  children,
}: {
  title: ReactNode;
  /** A string carries a filtered fraction — `12/40` — where a number cannot. */
  count?: number | string;
  actions?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section className={cn("flex flex-col gap-3", className)}>
      <SectionLabel count={count} actions={actions}>
        {title}
      </SectionLabel>
      {children}
    </section>
  );
}
