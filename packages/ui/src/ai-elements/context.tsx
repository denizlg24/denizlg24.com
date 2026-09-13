"use client";

import type { LanguageModelUsage } from "ai";
import type { ComponentProps, ReactNode } from "react";
import { createContext, useContext, useMemo } from "react";

import { Button } from "../button";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "../hover-card";
import { cn } from "../utils";

/** USD amounts, priced by the caller from the same catalog that bills the request. */
export type ContextCost = {
  input?: number;
  output?: number;
  reasoning?: number;
  cacheRead?: number;
  total?: number;
};

type ContextValue = {
  usedTokens: number;
  maxTokens: number;
  usage?: LanguageModelUsage;
  cost?: ContextCost;
  modelId?: string;
};

const ContextContext = createContext<ContextValue | null>(null);

const useContextValue = () => {
  const context = useContext(ContextContext);
  if (!context) {
    throw new Error("Context components must be used within Context");
  }
  return context;
};

const usedFraction = ({ usedTokens, maxTokens }: ContextValue) =>
  maxTokens > 0 ? Math.min(Math.max(usedTokens / maxTokens, 0), 1) : 0;

const compactNumber = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 1,
  notation: "compact",
});

export const formatTokens = (tokens: number) => compactNumber.format(tokens);

const wholePercent = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 0,
  style: "percent",
});
const finePercent = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 1,
  style: "percent",
});

export const formatPercent = (fraction: number) =>
  (fraction > 0 && fraction < 0.1 ? finePercent : wholePercent).format(
    fraction,
  );

export const formatUsd = (amount: number) =>
  new Intl.NumberFormat("en-US", {
    currency: "USD",
    maximumFractionDigits: amount > 0 && amount < 0.01 ? 4 : 2,
    minimumFractionDigits: 2,
    style: "currency",
  }).format(amount);

export type ContextProps = ComponentProps<typeof HoverCard> & ContextValue;

export const Context = ({
  usedTokens,
  maxTokens,
  usage,
  cost,
  modelId,
  openDelay = 100,
  closeDelay = 100,
  ...props
}: ContextProps) => {
  const contextValue = useMemo(
    () => ({ cost, maxTokens, modelId, usage, usedTokens }),
    [cost, maxTokens, modelId, usage, usedTokens],
  );

  return (
    <ContextContext.Provider value={contextValue}>
      <HoverCard closeDelay={closeDelay} openDelay={openDelay} {...props} />
    </ContextContext.Provider>
  );
};

const RING_RADIUS = 9;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

export type ContextIconProps = ComponentProps<"svg">;

export const ContextIcon = ({ className, ...props }: ContextIconProps) => {
  const context = useContextValue();
  const fraction = usedFraction(context);

  return (
    <svg
      aria-hidden="true"
      className={cn(
        "size-3.5 shrink-0",
        fraction >= 0.9 && "text-destructive",
        className,
      )}
      viewBox="0 0 24 24"
      {...props}
    >
      <circle
        cx="12"
        cy="12"
        fill="none"
        opacity="0.25"
        r={RING_RADIUS}
        stroke="currentColor"
        strokeWidth="3"
      />
      <circle
        cx="12"
        cy="12"
        fill="none"
        r={RING_RADIUS}
        stroke="currentColor"
        strokeDasharray={`${RING_CIRCUMFERENCE} ${RING_CIRCUMFERENCE}`}
        strokeDashoffset={RING_CIRCUMFERENCE * (1 - fraction)}
        strokeLinecap="round"
        strokeWidth="3"
        transform="rotate(-90 12 12)"
      />
    </svg>
  );
};

export type ContextTriggerProps = ComponentProps<typeof Button> & {
  showCost?: boolean;
};

export const ContextTrigger = ({
  children,
  className,
  showCost = false,
  ...props
}: ContextTriggerProps) => {
  const context = useContextValue();
  const fraction = usedFraction(context);
  const totalCost = context.cost?.total;

  return (
    <HoverCardTrigger asChild>
      <Button
        aria-label={`Context ${formatPercent(fraction)} used`}
        className={cn(
          "h-7 gap-1.5 rounded-full px-2 text-xs font-normal text-muted-foreground tabular-nums shadow-none hover:text-foreground",
          className,
        )}
        size="sm"
        type="button"
        variant="ghost"
        {...props}
      >
        {children ?? (
          <>
            <ContextIcon />
            <span>{formatPercent(fraction)}</span>
            {showCost && totalCost !== undefined ? (
              <span className="text-muted-foreground/70">
                {formatUsd(totalCost)}
              </span>
            ) : null}
          </>
        )}
      </Button>
    </HoverCardTrigger>
  );
};

export type ContextContentProps = ComponentProps<typeof HoverCardContent>;

export const ContextContent = ({
  className,
  side = "top",
  align = "end",
  ...props
}: ContextContentProps) => (
  <HoverCardContent
    align={align}
    className={cn(
      "w-60 max-w-[calc(100vw-2rem)] divide-y divide-border overflow-hidden p-0 text-xs",
      className,
    )}
    side={side}
    {...props}
  />
);

export type ContextContentHeaderProps = ComponentProps<"div">;

export const ContextContentHeader = ({
  children,
  className,
  ...props
}: ContextContentHeaderProps) => {
  const context = useContextValue();
  const fraction = usedFraction(context);

  return (
    <div className={cn("w-full space-y-2 p-3", className)} {...props}>
      {children ?? (
        <>
          <div className="flex items-baseline justify-between gap-3 tabular-nums">
            <span className="font-medium text-foreground">
              {formatPercent(fraction)}
            </span>
            <span className="text-muted-foreground">
              {formatTokens(context.usedTokens)} /{" "}
              {formatTokens(context.maxTokens)}
            </span>
          </div>
          <div
            aria-hidden="true"
            className="h-0.5 w-full overflow-hidden rounded-full bg-muted"
          >
            <div
              className={cn(
                "h-full rounded-full bg-foreground/70 transition-[width]",
                fraction >= 0.9 && "bg-destructive",
              )}
              style={{ width: `${fraction * 100}%` }}
            />
          </div>
          {context.modelId ? (
            <div className="truncate font-mono text-[10px] text-muted-foreground/70">
              {context.modelId}
            </div>
          ) : null}
        </>
      )}
    </div>
  );
};

export type ContextContentBodyProps = ComponentProps<"div">;

export const ContextContentBody = ({
  className,
  ...props
}: ContextContentBodyProps) => (
  <div className={cn("w-full space-y-1 p-3", className)} {...props} />
);

export type ContextContentFooterProps = ComponentProps<"div">;

export const ContextContentFooter = ({
  children,
  className,
  ...props
}: ContextContentFooterProps) => {
  const { cost } = useContextValue();

  if (!children && cost?.total === undefined) {
    return null;
  }

  return (
    <div
      className={cn(
        "flex w-full items-center justify-between gap-3 p-3 tabular-nums",
        className,
      )}
      {...props}
    >
      {children ?? (
        <>
          <span className="text-muted-foreground">Total</span>
          <span className="font-medium text-foreground">
            {formatUsd(cost?.total ?? 0)}
          </span>
        </>
      )}
    </div>
  );
};

type UsageRowProps = ComponentProps<"div"> & {
  label: ReactNode;
  tokens: number;
  cost?: number;
};

const UsageRow = ({
  label,
  tokens,
  cost,
  className,
  ...props
}: UsageRowProps) => (
  <div
    className={cn(
      "flex items-center justify-between gap-3 tabular-nums",
      className,
    )}
    {...props}
  >
    <span className="text-muted-foreground">{label}</span>
    <span className="text-foreground">
      {formatTokens(tokens)}
      {cost !== undefined ? (
        <span className="ml-2 text-muted-foreground">{formatUsd(cost)}</span>
      ) : null}
    </span>
  </div>
);

export type ContextUsageRowProps = ComponentProps<"div">;

export const ContextInputUsage = ({
  children,
  ...props
}: ContextUsageRowProps) => {
  const { usage, cost } = useContextValue();
  const tokens = usage?.inputTokens ?? 0;
  if (children) {
    return children;
  }
  if (!tokens) {
    return null;
  }
  return (
    <UsageRow cost={cost?.input} label="Input" tokens={tokens} {...props} />
  );
};

export const ContextOutputUsage = ({
  children,
  ...props
}: ContextUsageRowProps) => {
  const { usage, cost } = useContextValue();
  const tokens = usage?.outputTokens ?? 0;
  if (children) {
    return children;
  }
  if (!tokens) {
    return null;
  }
  return (
    <UsageRow cost={cost?.output} label="Output" tokens={tokens} {...props} />
  );
};

export const ContextReasoningUsage = ({
  children,
  ...props
}: ContextUsageRowProps) => {
  const { usage, cost } = useContextValue();
  const tokens = usage?.outputTokenDetails?.reasoningTokens ?? 0;
  if (children) {
    return children;
  }
  if (!tokens) {
    return null;
  }
  return (
    <UsageRow
      cost={cost?.reasoning}
      label="Reasoning"
      tokens={tokens}
      {...props}
    />
  );
};

export const ContextCacheUsage = ({
  children,
  ...props
}: ContextUsageRowProps) => {
  const { usage, cost } = useContextValue();
  const tokens = usage?.inputTokenDetails?.cacheReadTokens ?? 0;
  if (children) {
    return children;
  }
  if (!tokens) {
    return null;
  }
  return (
    <UsageRow
      cost={cost?.cacheRead}
      label="Cached"
      tokens={tokens}
      {...props}
    />
  );
};
