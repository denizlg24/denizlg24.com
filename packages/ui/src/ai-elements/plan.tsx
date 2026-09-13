"use client";

import { ChevronsUpDownIcon } from "lucide-react";
import type { ComponentProps } from "react";
import { createContext, useContext, useMemo } from "react";

import { Button } from "../button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "../collapsible";
import { cn } from "../utils";
import { Shimmer } from "./shimmer";

type PlanContextValue = {
  isStreaming: boolean;
};

const PlanContext = createContext<PlanContextValue | null>(null);

const usePlan = () => {
  const context = useContext(PlanContext);
  if (!context) {
    throw new Error("Plan components must be used within Plan");
  }
  return context;
};

export type PlanProps = ComponentProps<typeof Collapsible> & {
  isStreaming?: boolean;
};

export const Plan = ({
  className,
  isStreaming = false,
  children,
  ...props
}: PlanProps) => {
  const contextValue = useMemo(() => ({ isStreaming }), [isStreaming]);

  return (
    <PlanContext.Provider value={contextValue}>
      <Collapsible
        data-slot="plan"
        data-streaming={isStreaming || undefined}
        className={cn("not-prose w-full min-w-0 space-y-2", className)}
        {...props}
      >
        {children}
      </Collapsible>
    </PlanContext.Provider>
  );
};

export type PlanHeaderProps = ComponentProps<"div">;

export const PlanHeader = ({ className, ...props }: PlanHeaderProps) => (
  <div
    data-slot="plan-header"
    className={cn("flex min-w-0 items-start justify-between gap-3", className)}
    {...props}
  />
);

export type PlanTitleProps = Omit<ComponentProps<"div">, "children"> & {
  children: string;
};

export const PlanTitle = ({
  children,
  className,
  ...props
}: PlanTitleProps) => {
  const { isStreaming } = usePlan();

  return (
    <div
      data-slot="plan-title"
      className={cn(
        "min-w-0 text-sm leading-snug font-medium text-foreground",
        className,
      )}
      {...props}
    >
      {isStreaming ? <Shimmer>{children}</Shimmer> : children}
    </div>
  );
};

export type PlanDescriptionProps = Omit<ComponentProps<"p">, "children"> & {
  children: string;
};

export const PlanDescription = ({
  className,
  children,
  ...props
}: PlanDescriptionProps) => {
  const { isStreaming } = usePlan();

  return (
    <p
      data-slot="plan-description"
      className={cn(
        "mt-0.5 text-xs leading-relaxed text-balance text-muted-foreground",
        className,
      )}
      {...props}
    >
      {isStreaming ? <Shimmer>{children}</Shimmer> : children}
    </p>
  );
};

export type PlanActionProps = ComponentProps<"div">;

export const PlanAction = ({ className, ...props }: PlanActionProps) => (
  <div
    data-slot="plan-action"
    className={cn("flex shrink-0 items-center gap-1", className)}
    {...props}
  />
);

export type PlanContentProps = ComponentProps<typeof CollapsibleContent>;

export const PlanContent = ({ className, ...props }: PlanContentProps) => (
  <CollapsibleContent
    data-slot="plan-content"
    className={cn(
      "space-y-1.5 border-l border-border pl-3 text-xs text-muted-foreground outline-none",
      "data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0",
      className,
    )}
    {...props}
  />
);

export type PlanFooterProps = ComponentProps<"div">;

export const PlanFooter = ({ className, ...props }: PlanFooterProps) => (
  <div
    data-slot="plan-footer"
    className={cn(
      "flex min-w-0 items-center gap-2 pt-1 text-xs text-muted-foreground",
      className,
    )}
    {...props}
  />
);

export type PlanTriggerProps = ComponentProps<typeof CollapsibleTrigger>;

export const PlanTrigger = ({ className, ...props }: PlanTriggerProps) => (
  <CollapsibleTrigger asChild>
    <Button
      data-slot="plan-trigger"
      className={cn(
        "size-6 text-muted-foreground hover:text-foreground",
        className,
      )}
      size="icon-xs"
      type="button"
      variant="ghost"
      {...props}
    >
      <ChevronsUpDownIcon className="size-3.5" />
      <span className="sr-only">Toggle plan</span>
    </Button>
  </CollapsibleTrigger>
);
