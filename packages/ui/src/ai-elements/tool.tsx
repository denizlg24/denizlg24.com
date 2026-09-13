"use client";

import type { DynamicToolUIPart, ToolUIPart } from "ai";
import { CheckIcon, ChevronRightIcon, WrenchIcon } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import { isValidElement } from "react";

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "../collapsible";
import { cn } from "../utils";
import { Shimmer } from "./shimmer";

export type ToolPart = ToolUIPart | DynamicToolUIPart;
export type ToolState = ToolPart["state"];

export const humanizeToolName = (name: string) => {
  const words = name
    .replace(/[_\-.]+/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : "Tool";
};

const toolNameOf = (type: ToolPart["type"], toolName?: string) =>
  type === "dynamic-tool" ? (toolName ?? "") : type.slice("tool-".length);

export type ToolProps = ComponentProps<typeof Collapsible>;

export const Tool = ({ className, ...props }: ToolProps) => (
  <Collapsible
    data-slot="tool"
    className={cn("group/tool not-prose w-full min-w-0", className)}
    {...props}
  />
);

export type ToolStatusProps = Omit<ComponentProps<"span">, "children"> & {
  state: ToolState;
  approved?: boolean;
  preliminary?: boolean;
};

export const ToolStatus = ({
  state,
  approved,
  preliminary = false,
  className,
  ...props
}: ToolStatusProps) => {
  const base = cn("shrink-0 whitespace-nowrap text-xs", className);

  switch (state) {
    case "input-streaming":
      return (
        <span data-tool-state={state} className={base} {...props}>
          <Shimmer>Preparing</Shimmer>
        </span>
      );
    case "input-available":
      return (
        <span data-tool-state={state} className={base} {...props}>
          <Shimmer>Running</Shimmer>
        </span>
      );
    case "approval-requested":
      return (
        <span
          data-tool-state={state}
          className={cn(base, "font-medium text-foreground")}
          {...props}
        >
          Needs approval
        </span>
      );
    case "approval-responded":
      return (
        <span
          data-tool-state={state}
          className={cn(base, "text-muted-foreground")}
          {...props}
        >
          {approved === false ? "Denied" : "Approved"}
        </span>
      );
    case "output-available":
      return preliminary ? (
        <span data-tool-state={state} className={base} {...props}>
          <Shimmer>Running</Shimmer>
        </span>
      ) : (
        <span
          data-tool-state={state}
          className={cn(base, "flex items-center text-muted-foreground")}
          {...props}
        >
          <CheckIcon aria-hidden="true" className="size-3" />
          <span className="sr-only">Done</span>
        </span>
      );
    case "output-error":
      return (
        <span
          data-tool-state={state}
          className={cn(base, "text-destructive")}
          {...props}
        >
          Error
        </span>
      );
    case "output-denied":
      return (
        <span
          data-tool-state={state}
          className={cn(base, "text-muted-foreground")}
          {...props}
        >
          Denied
        </span>
      );
  }
};

type ToolHeaderSource =
  | {
      part: ToolPart;
      type?: never;
      state?: never;
      toolName?: never;
    }
  | {
      part?: never;
      type: ToolUIPart["type"];
      state: ToolState;
      toolName?: never;
    }
  | {
      part?: never;
      type: DynamicToolUIPart["type"];
      state: ToolState;
      toolName: string;
    };

export type ToolHeaderProps = Omit<
  ComponentProps<typeof CollapsibleTrigger>,
  "title" | "type" | "part"
> &
  ToolHeaderSource & {
    /** Humanised label, e.g. "Notes · list". Falls back to the part's title, then the tool name. */
    title?: ReactNode;
    /** Where the tool came from, e.g. an MCP connector name. */
    provenance?: ReactNode;
    icon?: ReactNode;
  };

export const ToolHeader = ({
  className,
  part,
  type,
  state,
  toolName,
  title,
  provenance,
  icon,
  ...props
}: ToolHeaderProps) => {
  const resolvedType = part?.type ?? type;
  const resolvedState = part?.state ?? state;
  const resolvedToolName =
    part?.type === "dynamic-tool" ? part.toolName : toolName;

  if (resolvedType === undefined || resolvedState === undefined) {
    return null;
  }

  const label =
    title ??
    part?.title ??
    humanizeToolName(toolNameOf(resolvedType, resolvedToolName));

  return (
    <CollapsibleTrigger
      data-slot="tool-header"
      data-tool-state={resolvedState}
      className={cn(
        "group/tool-header flex w-full min-w-0 items-center gap-2 rounded-sm py-0.5 text-left text-xs text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50",
        className,
      )}
      {...props}
    >
      <span
        aria-hidden="true"
        className="flex size-3 shrink-0 items-center justify-center [&_svg:not([class*='size-'])]:size-3"
      >
        {icon ?? <WrenchIcon />}
      </span>
      <span className="flex min-w-0 flex-1 items-baseline gap-1.5">
        <span className="min-w-0 truncate">{label}</span>
        {provenance ? (
          <span className="min-w-0 shrink-[3] truncate text-muted-foreground/60">
            {provenance}
          </span>
        ) : null}
      </span>
      <ToolStatus
        approved={part?.approval?.approved}
        preliminary={
          part?.state === "output-available" ? part.preliminary : undefined
        }
        state={resolvedState}
      />
      <ChevronRightIcon
        aria-hidden="true"
        className="size-3 shrink-0 transition-transform group-data-[state=open]/tool-header:rotate-90"
      />
    </CollapsibleTrigger>
  );
};

export type ToolContentProps = ComponentProps<typeof CollapsibleContent>;

export const ToolContent = ({ className, ...props }: ToolContentProps) => (
  <CollapsibleContent
    data-slot="tool-content"
    className={cn(
      "mt-1.5 ml-1.5 min-w-0 space-y-2.5 border-l border-border pb-1 pl-3 outline-none",
      "data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0",
      className,
    )}
    {...props}
  />
);

const stringifyValue = (value: unknown): string => {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
      try {
        return JSON.stringify(JSON.parse(trimmed), null, 2);
      } catch {
        return value;
      }
    }
    return value;
  }
  try {
    return JSON.stringify(value, null, 2) ?? String(value);
  } catch {
    return String(value);
  }
};

const ToolSectionLabel = ({ children }: { children: ReactNode }) => (
  <div className="text-[10px] font-medium tracking-wider text-muted-foreground/70 uppercase">
    {children}
  </div>
);

const TOOL_PRE_CLASSES =
  "overflow-auto font-mono text-[11px] leading-relaxed whitespace-pre-wrap wrap-anywhere";

export type ToolInputProps = ComponentProps<"div"> & {
  input: ToolPart["input"];
};

export const ToolInput = ({ className, input, ...props }: ToolInputProps) => {
  if (input === undefined) {
    return null;
  }

  return (
    <div
      data-slot="tool-input"
      className={cn("min-w-0 space-y-1", className)}
      {...props}
    >
      <ToolSectionLabel>Input</ToolSectionLabel>
      <pre className={cn(TOOL_PRE_CLASSES, "max-h-40 text-muted-foreground")}>
        {stringifyValue(input)}
      </pre>
    </div>
  );
};

export type ToolOutputProps = ComponentProps<"div"> & {
  output: ToolPart["output"];
  errorText: ToolPart["errorText"];
};

export const ToolOutput = ({
  className,
  output,
  errorText,
  ...props
}: ToolOutputProps) => {
  if (output === undefined && !errorText) {
    return null;
  }

  return (
    <div
      data-slot="tool-output"
      className={cn("min-w-0 space-y-1", className)}
      {...props}
    >
      <ToolSectionLabel>{errorText ? "Error" : "Output"}</ToolSectionLabel>
      {errorText ? (
        <pre className={cn(TOOL_PRE_CLASSES, "max-h-40 text-destructive")}>
          {errorText}
        </pre>
      ) : isValidElement(output) ? (
        <div className="max-h-60 min-w-0 overflow-auto text-xs">{output}</div>
      ) : (
        <pre
          className={cn(
            TOOL_PRE_CLASSES,
            "max-h-60 scroll-fade-b text-muted-foreground",
          )}
        >
          {stringifyValue(output)}
        </pre>
      )}
    </div>
  );
};
