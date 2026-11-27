"use client";

import { ArrowUpRight, ChevronDownIcon } from "lucide-react";
import type { ComponentProps } from "react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";

export type SourcesProps = ComponentProps<typeof Collapsible>;

export const Sources = ({
  className,
  defaultOpen = true,
  ...props
}: SourcesProps) => (
  <Collapsible
    className={cn("group/sources not-prose chat-tool", className)}
    defaultOpen={defaultOpen}
    {...props}
  />
);

export type SourcesTriggerProps = ComponentProps<typeof CollapsibleTrigger> & {
  count: number;
};

export const SourcesTrigger = ({
  className,
  count,
  children,
  ...props
}: SourcesTriggerProps) => (
  <CollapsibleTrigger
    className={cn(
      "kicker flex min-h-5 items-center gap-1 text-muted-foreground hover:text-foreground",
      className,
    )}
    {...props}
  >
    {children ?? (
      <>
        <span>Sources · {count}</span>
        <ChevronDownIcon
          aria-hidden
          className="size-3 -rotate-90 transition-transform group-data-[state=open]/sources:rotate-0 motion-reduce:transition-none"
        />
      </>
    )}
  </CollapsibleTrigger>
);

export type SourcesContentProps = ComponentProps<typeof CollapsibleContent>;

export const SourcesContent = ({
  className,
  children,
  ...props
}: SourcesContentProps) => (
  <CollapsibleContent className={cn("outline-none", className)} {...props}>
    <ol className="chat-sources">{children}</ol>
  </CollapsibleContent>
);

export type SourceProps = ComponentProps<"a"> & {
  meta?: string;
};

export const Source = ({
  href,
  title,
  meta,
  children,
  ...props
}: SourceProps) => (
  <li>
    <a href={href} rel="noopener noreferrer" target="_blank" {...props}>
      {children ?? title}
      <ArrowUpRight aria-hidden />
    </a>
    {meta ? <span className="meta">{meta}</span> : null}
  </li>
);
