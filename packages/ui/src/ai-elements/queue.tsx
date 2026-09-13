"use client";

import { ChevronRightIcon, PaperclipIcon } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";

import { Button } from "../button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "../collapsible";
import { cn } from "../utils";

export type QueueMessagePart = {
  type: string;
  text?: string;
  url?: string;
  filename?: string;
  mediaType?: string;
};

export type QueueMessage = {
  id: string;
  parts: QueueMessagePart[];
};

export type QueueTodo = {
  id: string;
  title: string;
  description?: string;
  status?: "pending" | "completed";
};

export type QueueItemProps = ComponentProps<"li">;

export const QueueItem = ({ className, ...props }: QueueItemProps) => (
  <li
    data-slot="queue-item"
    className={cn(
      "group/queue-item flex min-w-0 flex-col gap-0.5 rounded-sm px-1.5 py-1 text-xs transition-colors hover:bg-surface",
      className,
    )}
    {...props}
  />
);

export type QueueItemIndicatorProps = ComponentProps<"span"> & {
  completed?: boolean;
};

export const QueueItemIndicator = ({
  completed = false,
  className,
  ...props
}: QueueItemIndicatorProps) => (
  <span
    aria-hidden="true"
    data-completed={completed || undefined}
    className={cn(
      "mt-[5px] inline-block size-2 shrink-0 rounded-full border",
      completed
        ? "border-muted-foreground/30 bg-muted-foreground/30"
        : "border-muted-foreground/60",
      className,
    )}
    {...props}
  />
);

export type QueueItemContentProps = ComponentProps<"span"> & {
  completed?: boolean;
};

export const QueueItemContent = ({
  completed = false,
  className,
  ...props
}: QueueItemContentProps) => (
  <span
    className={cn(
      "line-clamp-1 min-w-0 grow leading-5 wrap-break-word",
      completed
        ? "text-muted-foreground/60 line-through decoration-muted-foreground/40"
        : "text-foreground/90",
      className,
    )}
    {...props}
  />
);

export type QueueItemDescriptionProps = ComponentProps<"div"> & {
  completed?: boolean;
};

export const QueueItemDescription = ({
  completed = false,
  className,
  ...props
}: QueueItemDescriptionProps) => (
  <div
    className={cn(
      "ml-4 text-[11px] leading-relaxed",
      completed
        ? "text-muted-foreground/50 line-through"
        : "text-muted-foreground",
      className,
    )}
    {...props}
  />
);

export type QueueItemActionsProps = ComponentProps<"div">;

export const QueueItemActions = ({
  className,
  ...props
}: QueueItemActionsProps) => (
  <div className={cn("flex shrink-0 gap-0.5", className)} {...props} />
);

export type QueueItemActionProps = Omit<
  ComponentProps<typeof Button>,
  "variant" | "size"
>;

export const QueueItemAction = ({
  className,
  ...props
}: QueueItemActionProps) => (
  <Button
    className={cn(
      "size-5 rounded-sm p-0 text-muted-foreground opacity-0 transition-opacity group-hover/queue-item:opacity-100 group-focus-within/queue-item:opacity-100 hover:bg-transparent hover:text-foreground dark:hover:bg-transparent [&_svg:not([class*='size-'])]:size-3",
      className,
    )}
    size="icon-xs"
    type="button"
    variant="ghost"
    {...props}
  />
);

export type QueueItemAttachmentProps = ComponentProps<"div">;

export const QueueItemAttachment = ({
  className,
  ...props
}: QueueItemAttachmentProps) => (
  <div
    className={cn("mt-1 ml-4 flex flex-wrap gap-1.5", className)}
    {...props}
  />
);

export type QueueItemImageProps = ComponentProps<"img">;

export const QueueItemImage = ({
  className,
  alt = "",
  ...props
}: QueueItemImageProps) => (
  <img
    alt={alt}
    className={cn("size-8 rounded-sm object-cover", className)}
    height={32}
    width={32}
    {...props}
  />
);

export type QueueItemFileProps = ComponentProps<"span">;

export const QueueItemFile = ({
  children,
  className,
  ...props
}: QueueItemFileProps) => (
  <span
    className={cn(
      "inline-flex max-w-40 items-center gap-1 rounded-sm bg-surface px-1.5 py-0.5 text-[11px] text-muted-foreground",
      className,
    )}
    {...props}
  >
    <PaperclipIcon aria-hidden="true" className="size-3 shrink-0" />
    <span className="truncate">{children}</span>
  </span>
);

export type QueueListProps = ComponentProps<"ul">;

export const QueueList = ({ className, ...props }: QueueListProps) => (
  <ul
    data-slot="queue-list"
    className={cn(
      "mt-0.5 max-h-40 min-w-0 scroll-fade-y overflow-y-auto overscroll-contain",
      className,
    )}
    {...props}
  />
);

export type QueueSectionProps = ComponentProps<typeof Collapsible>;

export const QueueSection = ({
  className,
  defaultOpen = true,
  ...props
}: QueueSectionProps) => (
  <Collapsible
    data-slot="queue-section"
    className={cn("min-w-0", className)}
    defaultOpen={defaultOpen}
    {...props}
  />
);

export type QueueSectionTriggerProps = ComponentProps<"button">;

export const QueueSectionTrigger = ({
  className,
  ...props
}: QueueSectionTriggerProps) => (
  <CollapsibleTrigger asChild>
    <button
      className={cn(
        "group/queue-trigger flex w-full items-center justify-between gap-2 rounded-sm py-1 text-left text-xs text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50",
        className,
      )}
      type="button"
      {...props}
    />
  </CollapsibleTrigger>
);

export type QueueSectionLabelProps = ComponentProps<"span"> & {
  count?: number;
  label: string;
  icon?: ReactNode;
};

export const QueueSectionLabel = ({
  count,
  label,
  icon,
  className,
  ...props
}: QueueSectionLabelProps) => (
  <span
    className={cn(
      "flex min-w-0 items-center gap-1.5 [&_svg:not([class*='size-'])]:size-3",
      className,
    )}
    {...props}
  >
    <ChevronRightIcon
      aria-hidden="true"
      className="size-3 shrink-0 transition-transform group-data-[state=open]/queue-trigger:rotate-90"
    />
    {icon}
    <span className="truncate">
      {count !== undefined ? (
        <span className="tabular-nums">{count} </span>
      ) : null}
      {label}
    </span>
  </span>
);

export type QueueSectionContentProps = ComponentProps<
  typeof CollapsibleContent
>;

export const QueueSectionContent = ({
  className,
  ...props
}: QueueSectionContentProps) => (
  <CollapsibleContent className={cn("outline-none", className)} {...props} />
);

export type QueueProps = ComponentProps<"div">;

export const Queue = ({ className, ...props }: QueueProps) => (
  <div
    data-slot="queue"
    className={cn("flex w-full min-w-0 flex-col gap-1", className)}
    {...props}
  />
);
