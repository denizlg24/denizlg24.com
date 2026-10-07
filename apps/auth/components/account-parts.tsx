"use client";

import { formatDateTime, formatRelative } from "@repo/cloud-ui/format";
import { Button } from "@repo/ui/button";
import { Skeleton } from "@repo/ui/skeleton";
import { cn } from "@repo/ui/utils";
import type { ReactNode } from "react";

/** A relative time with the exact one on hover. */
export function When({ value }: { value: string }) {
  return (
    <time dateTime={value} title={formatDateTime(value)}>
      {formatRelative(value)}
    </time>
  );
}

/** The phone layout of a row: two lines and the actions, one hairline apart. */
export function StackedRow({
  leading,
  title,
  detail,
  actions,
}: {
  leading?: ReactNode;
  title: ReactNode;
  detail: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <li className="flex items-start justify-between gap-3 border-b py-3 last:border-b-0">
      <div className="flex min-w-0 items-start gap-3">
        {leading}
        <div className="flex min-w-0 flex-col gap-1">
          <span className="flex min-w-0 flex-wrap items-center gap-2 text-sm text-accent-strong">
            {title}
          </span>
          <span className="text-xs text-muted-foreground">{detail}</span>
        </div>
      </div>
      {actions ? (
        <div className="flex shrink-0 items-center gap-1">{actions}</div>
      ) : null}
    </li>
  );
}

export function SectionSkeleton({ rows }: { rows: number }) {
  return (
    <div className="flex flex-col gap-2" aria-busy="true">
      {Array.from({ length: rows }, (_, index) => (
        <Skeleton key={index} className="h-9 w-full" />
      ))}
    </div>
  );
}

/**
 * An app's logo, or its initial on a tile the same size. Same treatment as
 * the mark over the sign-in steps, so an app reads the same in both places.
 */
export function AppLogo({
  name,
  logoUrl,
  size = "sm",
}: {
  name: string;
  logoUrl: string | null;
  size?: "sm" | "md";
}) {
  const box = size === "md" ? "size-8 text-sm" : "size-6 text-xs";
  if (logoUrl) {
    return (
      // A logo is an arbitrary https URL its developer chose; next/image would
      // need every host allow-listed.
      <img
        src={logoUrl}
        alt=""
        width={size === "md" ? 32 : 24}
        height={size === "md" ? 32 : 24}
        referrerPolicy="no-referrer"
        className={cn("shrink-0 rounded-md object-cover", box)}
      />
    );
  }
  return (
    <span
      aria-hidden="true"
      className={cn(
        "flex shrink-0 items-center justify-center rounded-md bg-muted font-semibold text-accent-strong",
        box,
      )}
    >
      {name.slice(0, 1).toUpperCase() || "?"}
    </span>
  );
}

/** A section or page that failed to load: what went wrong and a retry. */
export function LoadError({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <div className="flex flex-col items-start gap-3">
      <p className="text-sm text-destructive" role="alert">
        {message}
      </p>
      <Button variant="outline" onClick={onRetry}>
        Try again
      </Button>
    </div>
  );
}

/** A label/value pair in a `<dl>`, one hairline apart. */
export function DetailRow({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1 border-b py-3 text-sm last:border-b-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </div>
  );
}

/** The host of a URL for display, or the URL itself when it does not parse. */
export function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}
