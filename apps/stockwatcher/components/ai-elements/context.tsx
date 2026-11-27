"use client";

import type { ComponentProps, ReactNode } from "react";
import { createContext, useContext, useMemo } from "react";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";

const ICON_RADIUS = 10;
const ICON_VIEWBOX = 24;
const ICON_CENTER = 12;
const ICON_STROKE_WIDTH = 3;

interface ContextSchema {
  used: number;
  max: number;
  format: (value: number) => string;
}

const ContextContext = createContext<ContextSchema | null>(null);

const useContextValue = () => {
  const context = useContext(ContextContext);

  if (!context) {
    throw new Error("Context components must be used within Context");
  }

  return context;
};

const share = ({ used, max }: ContextSchema) =>
  max > 0 ? Math.min(Math.max(used / max, 0), 1) : 1;

const percentFormat = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 1,
  style: "percent",
});

export type ContextProps = ComponentProps<typeof HoverCard> & ContextSchema;

export const Context = ({ used, max, format, ...props }: ContextProps) => {
  const contextValue = useMemo(
    () => ({ format, max, used }),
    [format, max, used],
  );

  return (
    <ContextContext.Provider value={contextValue}>
      <HoverCard closeDelay={80} openDelay={150} {...props} />
    </ContextContext.Provider>
  );
};

export const ContextIcon = ({ className }: { className?: string }) => {
  const context = useContextValue();
  const circumference = 2 * Math.PI * ICON_RADIUS;
  const dashOffset = circumference * (1 - share(context));

  return (
    <svg
      aria-hidden
      className={cn("size-3.5 flex-none", className)}
      viewBox={`0 0 ${ICON_VIEWBOX} ${ICON_VIEWBOX}`}
    >
      <circle
        cx={ICON_CENTER}
        cy={ICON_CENTER}
        fill="none"
        opacity="0.25"
        r={ICON_RADIUS}
        stroke="currentColor"
        strokeWidth={ICON_STROKE_WIDTH}
      />
      <circle
        cx={ICON_CENTER}
        cy={ICON_CENTER}
        fill="none"
        r={ICON_RADIUS}
        stroke="currentColor"
        strokeDasharray={`${circumference} ${circumference}`}
        strokeDashoffset={dashOffset}
        strokeWidth={ICON_STROKE_WIDTH}
        style={{ transform: "rotate(-90deg)", transformOrigin: "center" }}
      />
    </svg>
  );
};

export type ContextTriggerProps = ComponentProps<typeof HoverCardTrigger>;

export const ContextTrigger = (props: ContextTriggerProps) => (
  <HoverCardTrigger {...props} />
);

export type ContextContentProps = ComponentProps<typeof HoverCardContent>;

export const ContextContent = ({
  className,
  ...props
}: ContextContentProps) => (
  <HoverCardContent
    className={cn("grid w-64 gap-2 p-3", className)}
    {...props}
  />
);

export type ContextContentHeaderProps = ComponentProps<"div"> & {
  label?: ReactNode;
};

export const ContextContentHeader = ({
  children,
  className,
  label,
  ...props
}: ContextContentHeaderProps) => {
  const context = useContextValue();
  const ratio = share(context);

  return (
    <div className={cn("grid gap-1.5", className)} {...props}>
      {children ?? (
        <>
          <div className="flex items-baseline justify-between gap-3">
            <span className="font-semibold">
              {label ? (
                <span className="kicker mr-1.5 text-muted-foreground">
                  {label}
                </span>
              ) : null}
              {percentFormat.format(ratio)}
            </span>
            <span className="text-muted-foreground">
              of {context.format(context.max)}
            </span>
          </div>
          <Progress value={ratio * 100} />
        </>
      )}
    </div>
  );
};

export type ContextContentBodyProps = ComponentProps<"dl">;

export const ContextContentBody = ({
  className,
  ...props
}: ContextContentBodyProps) => (
  <dl className={cn("m-0 grid border-rule border-t", className)} {...props} />
);

export type ContextRowProps = {
  label: ReactNode;
  value: ReactNode;
  className?: string;
};

export const ContextRow = ({ label, value, className }: ContextRowProps) => (
  <div
    className={cn(
      "flex items-baseline justify-between gap-3 border-rule border-b py-1",
      className,
    )}
  >
    <dt className="text-muted-foreground">{label}</dt>
    <dd className="m-0 text-right">{value}</dd>
  </div>
);

export type ContextContentFooterProps = ComponentProps<"div">;

export const ContextContentFooter = ({
  className,
  ...props
}: ContextContentFooterProps) => (
  <div
    className={cn("flex items-center justify-between gap-3", className)}
    {...props}
  />
);
