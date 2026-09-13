"use client";

import { ChevronRightIcon, SearchIcon } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "../collapsible";
import { cn } from "../utils";

export type TaskItemFileProps = ComponentProps<"span">;

export const TaskItemFile = ({ className, ...props }: TaskItemFileProps) => (
  <span
    data-slot="task-item-file"
    className={cn(
      "inline-flex max-w-full items-center gap-1 truncate rounded-sm bg-surface px-1.5 py-px align-baseline font-mono text-[11px] text-foreground/90 [&_svg:not([class*='size-'])]:size-3",
      className,
    )}
    {...props}
  />
);

export type TaskItemProps = ComponentProps<"div">;

export const TaskItem = ({ className, ...props }: TaskItemProps) => (
  <div
    data-slot="task-item"
    className={cn(
      "min-w-0 text-xs leading-5 text-muted-foreground wrap-break-word",
      className,
    )}
    {...props}
  />
);

export type TaskProps = ComponentProps<typeof Collapsible>;

export const Task = ({
  defaultOpen = true,
  className,
  ...props
}: TaskProps) => (
  <Collapsible
    data-slot="task"
    className={cn("not-prose w-full min-w-0", className)}
    defaultOpen={defaultOpen}
    {...props}
  />
);

export type TaskTriggerProps = Omit<
  ComponentProps<typeof CollapsibleTrigger>,
  "title"
> & {
  title: ReactNode;
  icon?: ReactNode;
};

export const TaskTrigger = ({
  children,
  className,
  title,
  icon,
  ...props
}: TaskTriggerProps) => (
  <CollapsibleTrigger
    data-slot="task-trigger"
    className={cn(
      "group/task-trigger flex w-full min-w-0 items-center gap-2 rounded-sm text-left text-xs text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50",
      className,
    )}
    {...props}
  >
    {children ?? (
      <>
        <span
          aria-hidden="true"
          className="flex size-3 shrink-0 items-center justify-center [&_svg:not([class*='size-'])]:size-3"
        >
          {icon ?? <SearchIcon />}
        </span>
        <span className="min-w-0 truncate">{title}</span>
        <ChevronRightIcon
          aria-hidden="true"
          className="size-3 shrink-0 transition-transform group-data-[state=open]/task-trigger:rotate-90"
        />
      </>
    )}
  </CollapsibleTrigger>
);

export type TaskContentProps = ComponentProps<typeof CollapsibleContent>;

export const TaskContent = ({
  children,
  className,
  ...props
}: TaskContentProps) => (
  <CollapsibleContent
    data-slot="task-content"
    className={cn(
      "outline-none data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0",
      className,
    )}
    {...props}
  >
    <div className="mt-1.5 ml-1.5 space-y-1 border-l border-border pl-3">
      {children}
    </div>
  </CollapsibleContent>
);
