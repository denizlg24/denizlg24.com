import type { ReactNode } from "react";
import { cn } from "./utils";

/** Notion-style key/value rows for a record's metadata. */
export function Properties({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return <dl className={cn("flex flex-col", className)}>{children}</dl>;
}

export function Property({
  icon,
  label,
  className,
  children,
}: {
  icon?: ReactNode;
  label: ReactNode;
  className?: string;
  /** The value; an editable control renders flush in this column. */
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "grid min-h-8 grid-cols-[minmax(7rem,10rem)_minmax(0,1fr)] items-center gap-3 text-sm",
        className,
      )}
    >
      <dt className="flex min-w-0 items-center gap-2 text-muted-foreground [&_svg:not([class*='size-'])]:size-3.5">
        {icon}
        <span className="truncate">{label}</span>
      </dt>
      <dd className="min-w-0 text-accent-strong">{children}</dd>
    </div>
  );
}
