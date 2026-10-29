import type { ReactNode } from "react";
import { cn } from "./utils";

/**
 * The page system every admin surface is built from:
 *
 *   <Page>
 *     <PageHeader icon title leading>actions</PageHeader>
 *     <PageToolbar>search · filters · view switches</PageToolbar>   (optional)
 *     <PageBody width="default">…sections…</PageBody>
 *   </Page>
 *
 * Header and toolbar are fixed; only the body scrolls.
 */
export function Page({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={cn("flex h-full min-h-0 flex-col bg-background", className)}
    >
      {children}
    </div>
  );
}

const CRUMB_LINK =
  "truncate rounded px-1 py-0.5 text-muted-foreground transition-colors hover:bg-surface hover:text-accent-strong";

export type Crumb = { label: ReactNode; href?: string; onClick?: () => void };

/** The h-11 bar: leading slot (sidebar trigger, back), icon, title or breadcrumbs, actions. */
export function PageHeader({
  icon,
  title,
  crumbs,
  leading,
  className,
  children,
}: {
  icon?: ReactNode;
  title: ReactNode;
  /** Ancestors shown before the title, separated by a slash. */
  crumbs?: Crumb[];
  leading?: ReactNode;
  className?: string;
  /** Actions, right-aligned. */
  children?: ReactNode;
}) {
  return (
    <header
      data-slot="page-header"
      className={cn(
        "flex h-11 shrink-0 items-center gap-2 border-b px-3",
        className,
      )}
    >
      {leading}
      <div className="flex min-w-0 flex-1 items-center gap-1.5 text-sm">
        {crumbs?.map((crumb, index) => (
          <span
            key={index}
            className="flex min-w-0 shrink items-center gap-1.5"
          >
            {crumb.onClick ? (
              <button
                type="button"
                onClick={crumb.onClick}
                className={CRUMB_LINK}
              >
                {crumb.label}
              </button>
            ) : crumb.href ? (
              <a href={crumb.href} className={CRUMB_LINK}>
                {crumb.label}
              </a>
            ) : (
              <span className="truncate px-1 text-muted-foreground">
                {crumb.label}
              </span>
            )}
            <span className="text-muted-foreground/50">/</span>
          </span>
        ))}
        {icon ? (
          <span className="flex shrink-0 items-center text-muted-foreground [&_svg:not([class*='size-'])]:size-4">
            {icon}
          </span>
        ) : null}
        <h1 className="min-w-0 truncate font-semibold text-accent-strong">
          {title}
        </h1>
      </div>
      {children ? (
        <div className="flex shrink-0 items-center gap-1">{children}</div>
      ) : null}
    </header>
  );
}

/** A thin bar under the header for search, filters and view switches. */
export function PageToolbar({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      data-slot="page-toolbar"
      className={cn(
        "flex min-h-10 shrink-0 flex-wrap items-center gap-2 border-b px-3 py-1.5",
        className,
      )}
    >
      {children}
    </div>
  );
}

const BODY_WIDTH = {
  narrow: "max-w-3xl",
  default: "max-w-5xl",
  wide: "max-w-7xl",
  full: "max-w-none",
} as const;

/** The scrolling region. `bleed` drops the padding for canvases and tables that own their edges. */
export function PageBody({
  width = "default",
  bleed = false,
  className,
  children,
}: {
  width?: keyof typeof BODY_WIDTH;
  bleed?: boolean;
  className?: string;
  children: ReactNode;
}) {
  if (bleed) {
    return (
      <div
        data-slot="page-body"
        className={cn("relative min-h-0 flex-1 overflow-hidden", className)}
      >
        {children}
      </div>
    );
  }
  return (
    <div
      data-slot="page-body"
      className="min-h-0 flex-1 overflow-y-auto overscroll-contain"
    >
      <div
        className={cn(
          "mx-auto flex w-full flex-col gap-8 px-5 py-6 sm:px-8",
          BODY_WIDTH[width],
          className,
        )}
      >
        {children}
      </div>
    </div>
  );
}

/**
 * The document title at the top of a record: icon, large title, and an
 * optional row of properties beneath. Notion's page title, for a record.
 */
export function PageTitle({
  icon,
  title,
  meta,
  actions,
  className,
}: {
  icon?: ReactNode;
  title: ReactNode;
  meta?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-2", className)}>
      {icon ? (
        <div className="text-4xl leading-none text-accent-strong [&_svg:not([class*='size-'])]:size-9">
          {icon}
        </div>
      ) : null}
      <div className="flex items-start gap-3">
        <h2 className="min-w-0 flex-1 text-2xl font-semibold leading-tight tracking-tight text-accent-strong break-words">
          {title}
        </h2>
        {actions ? (
          <div className="flex shrink-0 items-center gap-1 pt-0.5">
            {actions}
          </div>
        ) : null}
      </div>
      {meta ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          {meta}
        </div>
      ) : null}
    </div>
  );
}
