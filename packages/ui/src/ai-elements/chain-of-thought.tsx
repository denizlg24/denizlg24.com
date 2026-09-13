"use client";

import type { LucideIcon } from "lucide-react";
import { BrainIcon, ChevronRightIcon } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import { createContext, memo, useContext, useMemo } from "react";

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "../collapsible";
import { cn } from "../utils";
import { ReasoningLabel, useThinkingDuration } from "./reasoning";
import { Shimmer } from "./shimmer";

type ChainOfThoughtContextValue = {
  isStreaming: boolean;
  duration: number | undefined;
};

const ChainOfThoughtContext = createContext<ChainOfThoughtContextValue | null>(
  null,
);

const useChainOfThought = () => {
  const context = useContext(ChainOfThoughtContext);
  if (!context) {
    throw new Error(
      "ChainOfThought components must be used within ChainOfThought",
    );
  }
  return context;
};

export type ChainOfThoughtProps = ComponentProps<typeof Collapsible> & {
  isStreaming?: boolean;
  /** Seconds. Computed from the streaming window when omitted. */
  duration?: number;
};

export const ChainOfThought = memo(
  ({
    className,
    defaultOpen = false,
    isStreaming = false,
    duration: durationProp,
    children,
    ...props
  }: ChainOfThoughtProps) => {
    const duration = useThinkingDuration(isStreaming, durationProp);
    const contextValue = useMemo(
      () => ({ duration, isStreaming }),
      [duration, isStreaming],
    );

    return (
      <ChainOfThoughtContext.Provider value={contextValue}>
        <Collapsible
          data-slot="chain-of-thought"
          className={cn("not-prose w-full min-w-0", className)}
          defaultOpen={defaultOpen}
          {...props}
        >
          {children}
        </Collapsible>
      </ChainOfThoughtContext.Provider>
    );
  },
);

export type ChainOfThoughtHeaderProps = ComponentProps<
  typeof CollapsibleTrigger
>;

export const ChainOfThoughtHeader = memo(
  ({ className, children, ...props }: ChainOfThoughtHeaderProps) => {
    const { isStreaming, duration } = useChainOfThought();

    return (
      <CollapsibleTrigger
        data-slot="chain-of-thought-header"
        className={cn(
          "group/cot-trigger flex max-w-full items-center gap-1.5 rounded-sm text-xs text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50",
          className,
        )}
        {...props}
      >
        <BrainIcon aria-hidden="true" className="size-3 shrink-0" />
        <span className="truncate">
          {children ?? (
            <ReasoningLabel
              duration={duration}
              idleLabel="Chain of thought"
              isStreaming={isStreaming}
            />
          )}
        </span>
        <ChevronRightIcon
          aria-hidden="true"
          className="size-3 shrink-0 transition-transform group-data-[state=open]/cot-trigger:rotate-90"
        />
      </CollapsibleTrigger>
    );
  },
);

export type ChainOfThoughtStepProps = ComponentProps<"div"> & {
  icon?: LucideIcon;
  label: ReactNode;
  description?: ReactNode;
  status?: "complete" | "active" | "pending";
};

const stepStatusStyles = {
  active: "text-foreground",
  complete: "text-muted-foreground",
  pending: "text-muted-foreground/50",
} as const;

export const ChainOfThoughtStep = memo(
  ({
    className,
    icon: Icon,
    label,
    description,
    status = "complete",
    children,
    ...props
  }: ChainOfThoughtStepProps) => (
    <div
      data-slot="chain-of-thought-step"
      data-status={status}
      className={cn(
        "group/cot-step relative flex min-w-0 gap-2 pb-3 text-xs last:pb-0",
        stepStatusStyles[status],
        className,
      )}
      {...props}
    >
      <div className="relative flex w-3 shrink-0 flex-col items-center">
        <span className="flex h-5 items-center">
          {Icon ? (
            <Icon aria-hidden="true" className="size-3" />
          ) : (
            <span
              aria-hidden="true"
              className="size-1.5 rounded-full bg-current"
            />
          )}
        </span>
        <span
          aria-hidden="true"
          className="absolute top-5 bottom-0 left-1/2 w-px -translate-x-1/2 bg-border group-last/cot-step:hidden"
        />
      </div>
      <div className="min-w-0 flex-1 space-y-1">
        <div className="leading-5">
          {status === "active" ? <Shimmer>{label}</Shimmer> : label}
        </div>
        {description ? (
          <div className="text-muted-foreground">{description}</div>
        ) : null}
        {children}
      </div>
    </div>
  ),
);

export type ChainOfThoughtSearchResultsProps = ComponentProps<"div">;

export const ChainOfThoughtSearchResults = memo(
  ({ className, ...props }: ChainOfThoughtSearchResultsProps) => (
    <div
      data-slot="chain-of-thought-search-results"
      className={cn("flex flex-wrap items-center gap-1", className)}
      {...props}
    />
  ),
);

export type ChainOfThoughtSearchResultProps = ComponentProps<"span">;

export const ChainOfThoughtSearchResult = memo(
  ({ className, ...props }: ChainOfThoughtSearchResultProps) => (
    <span
      data-slot="chain-of-thought-search-result"
      className={cn(
        "inline-flex max-w-full items-center gap-1 truncate rounded-sm bg-surface px-1.5 py-0.5 text-[11px] text-muted-foreground",
        className,
      )}
      {...props}
    />
  ),
);

export type ChainOfThoughtContentProps = ComponentProps<
  typeof CollapsibleContent
>;

export const ChainOfThoughtContent = memo(
  ({ className, ...props }: ChainOfThoughtContentProps) => (
    <CollapsibleContent
      data-slot="chain-of-thought-content"
      className={cn(
        "mt-2 outline-none",
        "data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0",
        className,
      )}
      {...props}
    />
  ),
);

export type ChainOfThoughtImageProps = ComponentProps<"figure"> & {
  caption?: string;
};

export const ChainOfThoughtImage = memo(
  ({ className, children, caption, ...props }: ChainOfThoughtImageProps) => (
    <figure
      data-slot="chain-of-thought-image"
      className={cn("mt-1 space-y-1", className)}
      {...props}
    >
      <div className="relative flex max-h-72 items-center justify-center overflow-hidden rounded-md bg-surface">
        {children}
      </div>
      {caption ? (
        <figcaption className="text-[11px] text-muted-foreground">
          {caption}
        </figcaption>
      ) : null}
    </figure>
  ),
);

ChainOfThought.displayName = "ChainOfThought";
ChainOfThoughtHeader.displayName = "ChainOfThoughtHeader";
ChainOfThoughtStep.displayName = "ChainOfThoughtStep";
ChainOfThoughtSearchResults.displayName = "ChainOfThoughtSearchResults";
ChainOfThoughtSearchResult.displayName = "ChainOfThoughtSearchResult";
ChainOfThoughtContent.displayName = "ChainOfThoughtContent";
ChainOfThoughtImage.displayName = "ChainOfThoughtImage";
