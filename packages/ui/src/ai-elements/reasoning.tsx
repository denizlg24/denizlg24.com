"use client";

import { BrainIcon, ChevronRightIcon } from "lucide-react";
import { useControllableState } from "radix-ui/internal";
import type { ComponentProps, ReactNode } from "react";
import {
  createContext,
  memo,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
} from "react";

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "../collapsible";
import { cn } from "../utils";
import { MessageResponse } from "./message";
import { Shimmer } from "./shimmer";

type ReasoningContextValue = {
  isStreaming: boolean;
  isOpen: boolean;
  setIsOpen: (open: boolean) => void;
  duration: number | undefined;
};

const ReasoningContext = createContext<ReasoningContextValue | null>(null);

export const useReasoning = () => {
  const context = useContext(ReasoningContext);
  if (!context) {
    throw new Error("Reasoning components must be used within Reasoning");
  }
  return context;
};

export type ReasoningProps = ComponentProps<typeof Collapsible> & {
  isStreaming?: boolean;
  /** Seconds. Computed from the streaming window when omitted. */
  duration?: number;
};

/** Seconds spent streaming, measured on the client unless `duration` is given. */
export const useThinkingDuration = (
  isStreaming: boolean,
  durationProp?: number,
) => {
  const [duration, setDuration] = useControllableState<number | undefined>({
    defaultProp: undefined,
    prop: durationProp,
  });
  const startTimeRef = useRef<number | null>(null);

  useEffect(() => {
    if (isStreaming) {
      startTimeRef.current ??= Date.now();
    } else if (startTimeRef.current !== null) {
      setDuration(Math.ceil((Date.now() - startTimeRef.current) / 1000));
      startTimeRef.current = null;
    }
  }, [isStreaming, setDuration]);

  return duration;
};

export const Reasoning = memo(
  ({
    className,
    isStreaming = false,
    open,
    defaultOpen,
    onOpenChange,
    duration: durationProp,
    children,
    ...props
  }: ReasoningProps) => {
    const isExplicitlyClosed = defaultOpen === false;

    const [isOpen, setIsOpen] = useControllableState<boolean>({
      defaultProp: defaultOpen ?? isStreaming,
      onChange: onOpenChange,
      prop: open,
    });
    const duration = useThinkingDuration(isStreaming, durationProp);

    // Opens itself once when streaming starts and then leaves the toggle to
    // the reader: it never closes on its own, and a manual close mid-stream
    // is not undone.
    const wasStreamingRef = useRef(isStreaming);
    useEffect(() => {
      const started = isStreaming && !wasStreamingRef.current;
      wasStreamingRef.current = isStreaming;
      if (started && !isExplicitlyClosed) setIsOpen(true);
    }, [isStreaming, setIsOpen, isExplicitlyClosed]);

    const handleOpenChange = useCallback(
      (next: boolean) => setIsOpen(next),
      [setIsOpen],
    );

    const contextValue = useMemo(
      () => ({ duration, isOpen, isStreaming, setIsOpen }),
      [duration, isOpen, isStreaming, setIsOpen],
    );

    return (
      <ReasoningContext.Provider value={contextValue}>
        <Collapsible
          data-slot="reasoning"
          className={cn("not-prose w-full min-w-0", className)}
          onOpenChange={handleOpenChange}
          open={isOpen}
          {...props}
        >
          {children}
        </Collapsible>
      </ReasoningContext.Provider>
    );
  },
);

export type ReasoningLabelProps = {
  isStreaming: boolean;
  duration?: number;
  streamingLabel?: string;
  idleLabel?: string;
};

export const ReasoningLabel = ({
  isStreaming,
  duration,
  streamingLabel = "Thinking",
  idleLabel = "Reasoning",
}: ReasoningLabelProps) => {
  if (isStreaming) {
    return <Shimmer>{streamingLabel}</Shimmer>;
  }
  if (duration === undefined) {
    return <span>{idleLabel}</span>;
  }
  return (
    <span className="tabular-nums">
      Thought for {duration < 1 ? "<1" : duration}s
    </span>
  );
};

const defaultGetThinkingMessage = (isStreaming: boolean, duration?: number) => (
  <ReasoningLabel duration={duration} isStreaming={isStreaming} />
);

export type ReasoningTriggerProps = ComponentProps<
  typeof CollapsibleTrigger
> & {
  getThinkingMessage?: (isStreaming: boolean, duration?: number) => ReactNode;
};

export const ReasoningTrigger = memo(
  ({
    className,
    children,
    getThinkingMessage = defaultGetThinkingMessage,
    ...props
  }: ReasoningTriggerProps) => {
    const { isStreaming, duration } = useReasoning();

    return (
      <CollapsibleTrigger
        data-slot="reasoning-trigger"
        className={cn(
          "group/reasoning-trigger flex max-w-full items-center gap-1.5 rounded-sm text-xs text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50",
          className,
        )}
        {...props}
      >
        {children ?? (
          <>
            <BrainIcon aria-hidden="true" className="size-3 shrink-0" />
            <span className="truncate">
              {getThinkingMessage(isStreaming, duration)}
            </span>
            <ChevronRightIcon
              aria-hidden="true"
              className="size-3 shrink-0 transition-transform group-data-[state=open]/reasoning-trigger:rotate-90"
            />
          </>
        )}
      </CollapsibleTrigger>
    );
  },
);

export type ReasoningContentProps = Omit<
  ComponentProps<typeof CollapsibleContent>,
  "children"
> & {
  children: string;
};

export const ReasoningContent = memo(
  ({ className, children, ...props }: ReasoningContentProps) => {
    const { isStreaming } = useReasoning();

    return (
      <CollapsibleContent
        data-slot="reasoning-content"
        className={cn(
          "mt-2 ml-1.5 border-l border-border pl-3 outline-none",
          "data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0",
          className,
        )}
        {...props}
      >
        <MessageResponse
          className="space-y-2 text-xs text-muted-foreground"
          isAnimating={isStreaming}
        >
          {children}
        </MessageResponse>
      </CollapsibleContent>
    );
  },
);

Reasoning.displayName = "Reasoning";
ReasoningTrigger.displayName = "ReasoningTrigger";
ReasoningContent.displayName = "ReasoningContent";
