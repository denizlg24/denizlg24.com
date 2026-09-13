"use client";

import type { LucideProps } from "lucide-react";
import { BookmarkIcon } from "lucide-react";
import type { ComponentProps, HTMLAttributes } from "react";

import { Button } from "../button";
import { Separator } from "../separator";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../tooltip";
import { cn } from "../utils";

export type CheckpointProps = HTMLAttributes<HTMLDivElement>;

export const Checkpoint = ({
  className,
  children,
  ...props
}: CheckpointProps) => (
  <div
    data-slot="checkpoint"
    className={cn(
      "flex min-w-0 items-center gap-2 overflow-hidden text-xs text-muted-foreground",
      className,
    )}
    {...props}
  >
    {children}
    <Separator className="min-w-4 flex-1" />
  </div>
);

export type CheckpointIconProps = LucideProps;

export const CheckpointIcon = ({
  className,
  children,
  ...props
}: CheckpointIconProps) =>
  children ?? (
    <BookmarkIcon
      aria-hidden="true"
      className={cn("size-3 shrink-0", className)}
      {...props}
    />
  );

export type CheckpointTriggerProps = ComponentProps<typeof Button> & {
  tooltip?: string;
};

export const CheckpointTrigger = ({
  children,
  className,
  variant = "ghost",
  size = "xs",
  tooltip,
  ...props
}: CheckpointTriggerProps) => {
  const button = (
    <Button
      className={cn(
        "h-6 shrink-0 gap-1.5 px-1.5 text-xs font-normal text-muted-foreground hover:text-foreground",
        className,
      )}
      size={size}
      type="button"
      variant={variant}
      {...props}
    >
      {children}
    </Button>
  );

  if (!tooltip) {
    return button;
  }

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>{button}</TooltipTrigger>
        <TooltipContent align="start" side="bottom" sideOffset={4}>
          {tooltip}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
};
