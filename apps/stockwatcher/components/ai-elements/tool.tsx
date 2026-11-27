"use client";

import type { DynamicToolUIPart, ToolUIPart } from "ai";
import { ChevronDownIcon } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";

export type ToolState = ToolUIPart["state"] | DynamicToolUIPart["state"];

export type ToolProps = ComponentProps<typeof Collapsible> & {
  state: ToolState;
};

export const Tool = ({
  className,
  state,
  defaultOpen = true,
  ...props
}: ToolProps) => (
  <Collapsible
    className={cn("group/tool not-prose min-w-0", className)}
    data-tool-state={state}
    defaultOpen={defaultOpen}
    {...props}
  />
);

export const isToolRunning = (state: ToolState) =>
  state === "input-streaming" || state === "input-available";

export type ToolStatusProps = ComponentProps<"div"> & {
  text: ReactNode;
};

export const ToolStatus = ({ className, text, ...props }: ToolStatusProps) => (
  <div
    className={cn(
      "flex min-h-[22px] items-center gap-2 text-muted-foreground text-xs",
      className,
    )}
    role="status"
    {...props}
  >
    <span
      aria-hidden
      className="size-[5px] flex-none animate-pulse rounded-full bg-primary motion-reduce:animate-none"
    />
    <span className="min-w-0 truncate">{text}…</span>
  </div>
);

export type ToolHeaderProps = {
  title: ReactNode;
  meta?: ReactNode;
  className?: string;
};

export const ToolHeader = ({ className, title, meta }: ToolHeaderProps) => (
  <div
    className={cn(
      "flex min-h-5 items-baseline justify-between gap-3",
      className,
    )}
  >
    <CollapsibleTrigger className="kicker flex min-w-0 items-center gap-1 text-muted-foreground hover:text-foreground">
      <span className="truncate">{title}</span>
      <ChevronDownIcon
        aria-hidden
        className="size-3 flex-none -rotate-90 transition-transform group-data-[state=open]/tool:rotate-0 motion-reduce:transition-none"
      />
    </CollapsibleTrigger>
    {meta ? <span className="chat-tool-meta">{meta}</span> : null}
  </div>
);

export type ToolContentProps = ComponentProps<typeof CollapsibleContent>;

export const ToolContent = ({ className, ...props }: ToolContentProps) => (
  <CollapsibleContent
    className={cn("min-w-0 outline-none", className)}
    {...props}
  />
);
