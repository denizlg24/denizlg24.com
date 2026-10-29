"use client";

import { Button } from "@repo/ui/button";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/utils";

/** The quiet surface every floating canvas control sits on. */
export function FloatingBar({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "absolute z-40 flex cursor-auto items-center gap-0.5 overflow-x-auto rounded-lg border bg-background/95 p-0.5 shadow-sm backdrop-blur",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function BarDivider({ vertical = false }: { vertical?: boolean }) {
  return (
    <div
      className={cn(
        "shrink-0 bg-border",
        vertical ? "my-0.5 h-px w-5" : "mx-0.5 h-4 w-px",
      )}
    />
  );
}

/** A ghost icon button that reads as pressed while its tool is active. */
export function ToolButton({
  active,
  label,
  className,
  size = "icon-sm",
  ...props
}: Omit<ComponentProps<typeof Button>, "variant"> & {
  /** Set only on toggles; plain actions leave it undefined. */
  active?: boolean;
  label: string;
}) {
  return (
    <Button
      variant="ghost"
      size={size}
      aria-label={label}
      aria-pressed={active}
      title={label}
      className={cn(
        "text-muted-foreground hover:bg-surface/70 hover:text-accent-strong",
        active && "bg-surface text-accent-strong",
        className,
      )}
      {...props}
    />
  );
}
