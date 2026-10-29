import type * as React from "react";
import type { ReactNode } from "react";
import { cn } from "./utils";

/** A borderless list. Rows separate with hairlines only when `divided`. */
export function List({
  divided = false,
  className,
  children,
}: {
  divided?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      role="list"
      className={cn(
        "flex flex-col",
        divided && "divide-y divide-border/70",
        className,
      )}
    >
      {children}
    </div>
  );
}

/**
 * One row: leading glyph, title with an optional second line, meta (dates,
 * counts — tabular, muted) and trailing controls. Clickable when given
 * `onClick`; for navigation wrap it in a Link.
 */
export function ListRow({
  leading,
  title,
  description,
  meta,
  trailing,
  selected = false,
  className,
  children,
  ...props
}: Omit<React.ComponentProps<"div">, "title"> & {
  leading?: ReactNode;
  title?: ReactNode;
  description?: ReactNode;
  meta?: ReactNode;
  trailing?: ReactNode;
  selected?: boolean;
}) {
  const interactive = Boolean(props.onClick);
  return (
    <div
      role={interactive ? "button" : "listitem"}
      tabIndex={interactive ? 0 : undefined}
      data-selected={selected || undefined}
      onKeyDown={
        interactive
          ? (event) => {
              if (event.target !== event.currentTarget) return;
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                event.currentTarget.click();
              }
            }
          : undefined
      }
      className={cn(
        "group/row -mx-2 flex min-h-9 items-center gap-3 rounded-md px-2 py-1.5 text-left transition-colors",
        "[a>&]:cursor-pointer [a:hover>&]:bg-surface/70",
        interactive &&
          "cursor-pointer hover:bg-surface/70 focus-visible:bg-surface/70 focus-visible:outline-none",
        "data-[selected]:bg-surface",
        className,
      )}
      {...props}
    >
      {leading ? (
        <span className="flex min-h-5 min-w-5 shrink-0 items-center justify-center text-muted-foreground [&_svg:not([class*='size-'])]:size-4">
          {leading}
        </span>
      ) : null}
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-sm text-accent-strong">{title}</span>
        {description ? (
          <span className="truncate text-xs text-muted-foreground">
            {description}
          </span>
        ) : null}
      </span>
      {children}
      {meta ? (
        <span className="flex shrink-0 items-center gap-2 text-xs tabular-nums text-muted-foreground">
          {meta}
        </span>
      ) : null}
      {trailing ? (
        // Controls in the trailing slot act on their own, never on the row.
        <span
          className="flex shrink-0 items-center gap-1"
          onClick={(event) => event.stopPropagation()}
          onKeyDown={(event) => event.stopPropagation()}
        >
          {trailing}
        </span>
      ) : null}
    </div>
  );
}

/** A sticky label above a group of rows ("Today", "Last week"). */
export function ListGroupLabel({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "pt-4 pb-1 text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground first:pt-0",
        className,
      )}
    >
      {children}
    </div>
  );
}
