"use client";

import { cva, type VariantProps } from "class-variance-authority";
import { Slot } from "radix-ui";
import type * as React from "react";

import { cn } from "./utils";

const badgeVariants = cva(
  "inline-flex h-5 items-center justify-center rounded-md border border-transparent px-1.5 text-[11px] font-medium tabular-nums w-fit whitespace-nowrap shrink-0 [&>svg]:size-3 gap-1 [&>svg]:pointer-events-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive transition-[color,box-shadow] overflow-hidden",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground [a&]:hover:bg-primary/90",
        secondary:
          "bg-surface text-accent-strong dark:bg-muted [a&]:hover:bg-muted/60",
        destructive:
          "bg-destructive/12 text-destructive dark:bg-destructive/30 dark:text-foreground",
        outline:
          "border-border text-muted-foreground [a&]:hover:bg-surface [a&]:hover:text-accent-strong",
        ghost: "text-muted-foreground [a&]:hover:bg-surface",
        good: "bg-status-good/12 text-status-good dark:bg-status-good/20",
        warning:
          "bg-status-warning/15 text-[color-mix(in_oklab,var(--status-warning)_55%,black)] dark:bg-status-warning/20 dark:text-status-warning",
        critical:
          "bg-status-critical/12 text-status-critical dark:bg-status-critical/20",
        info: "bg-status-info/12 text-status-info dark:bg-status-info/20",
        link: "text-primary underline-offset-4 [a&]:hover:underline",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

function Badge({
  className,
  variant = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"span"> &
  VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : "span";

  return (
    <Comp
      data-slot="badge"
      data-variant={variant}
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    />
  );
}

export { Badge, badgeVariants };
