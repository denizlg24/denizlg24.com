import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";
import { Slot } from "radix-ui";

const badgeVariants = cva(
  "inline-flex h-[18px] w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-sm border border-transparent px-1.5 text-[0.6875rem] leading-none font-semibold tracking-[0.01em] whitespace-nowrap tabular-nums aria-invalid:border-destructive [&>svg]:pointer-events-none [&>svg]:size-3",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground [a&]:hover:bg-primary/90",
        secondary:
          "bg-secondary text-secondary-foreground [a&]:hover:bg-secondary/80",
        destructive: "bg-loss-soft text-loss",
        gain: "bg-gain-soft text-gain",
        loss: "bg-loss-soft text-loss",
        outline:
          "border-input text-muted-foreground [a&]:hover:bg-muted [a&]:hover:text-foreground",
        ghost:
          "text-muted-foreground [a&]:hover:bg-muted [a&]:hover:text-foreground",
        link: "px-0 text-secondary-foreground underline-offset-[0.2em] [a&]:hover:underline",
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
