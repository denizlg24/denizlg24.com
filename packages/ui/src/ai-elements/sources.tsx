"use client";

import { ChevronRightIcon } from "lucide-react";
import type { ComponentProps } from "react";

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "../collapsible";
import { cn } from "../utils";

export const sourceHostname = (url: string | undefined) => {
  if (!url) {
    return undefined;
  }
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return undefined;
  }
};

export type SourcesProps = ComponentProps<typeof Collapsible>;

export const Sources = ({ className, ...props }: SourcesProps) => (
  <Collapsible
    data-slot="sources"
    className={cn("not-prose w-full min-w-0 text-xs", className)}
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
    data-slot="sources-trigger"
    className={cn(
      "group/sources-trigger flex items-center gap-1.5 rounded-sm text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50",
      className,
    )}
    {...props}
  >
    {children ?? (
      <>
        <span className="tabular-nums">
          {count} {count === 1 ? "source" : "sources"}
        </span>
        <ChevronRightIcon
          aria-hidden="true"
          className="size-3 transition-transform group-data-[state=open]/sources-trigger:rotate-90"
        />
      </>
    )}
  </CollapsibleTrigger>
);

export type SourcesContentProps = ComponentProps<typeof CollapsibleContent>;

export const SourcesContent = ({
  className,
  ...props
}: SourcesContentProps) => (
  <CollapsibleContent
    data-slot="sources-content"
    className={cn(
      "mt-1.5 flex min-w-0 flex-col outline-none",
      "data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0",
      className,
    )}
    {...props}
  />
);

export type SourceProps = ComponentProps<"a">;

export const Source = ({
  href,
  title,
  children,
  className,
  ...props
}: SourceProps) => {
  const hostname = sourceHostname(href);

  return (
    <a
      data-slot="source"
      className={cn(
        "group/source flex min-w-0 items-baseline gap-2 border-b border-border/50 py-1 last:border-b-0",
        className,
      )}
      href={href}
      rel="noreferrer"
      target="_blank"
      {...props}
    >
      {children ?? (
        <>
          <span className="min-w-0 truncate text-foreground/90 underline-offset-2 group-hover/source:underline">
            {title ?? hostname ?? href}
          </span>
          {hostname && title ? (
            <span className="ml-auto shrink-0 text-muted-foreground/70">
              {hostname}
            </span>
          ) : null}
        </>
      )}
    </a>
  );
};
