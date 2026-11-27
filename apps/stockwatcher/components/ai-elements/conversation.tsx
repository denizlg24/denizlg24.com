"use client";

import { ArrowDownIcon } from "lucide-react";
import type { ComponentProps } from "react";
import { useSyncExternalStore } from "react";
import { StickToBottom, useStickToBottomContext } from "use-stick-to-bottom";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const reducedMotionQuery = "(prefers-reduced-motion: reduce)";

function subscribeReducedMotion(onChange: () => void) {
  const query = window.matchMedia(reducedMotionQuery);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

function useReducedMotion() {
  return useSyncExternalStore(
    subscribeReducedMotion,
    () => window.matchMedia(reducedMotionQuery).matches,
    () => false,
  );
}

export type ConversationProps = ComponentProps<typeof StickToBottom>;

export const Conversation = ({ className, ...props }: ConversationProps) => {
  const reduced = useReducedMotion();
  return (
    <StickToBottom
      className={cn("relative min-h-0 flex-1", className)}
      initial="instant"
      resize={reduced ? "instant" : "smooth"}
      role="log"
      {...props}
    />
  );
};

export type ConversationContentProps = ComponentProps<
  typeof StickToBottom.Content
>;

export const ConversationContent = ({
  className,
  scrollClassName,
  ...props
}: ConversationContentProps) => (
  <StickToBottom.Content
    className={cn("flex flex-col", className)}
    scrollClassName={cn(
      "overscroll-contain [scrollbar-gutter:stable]",
      scrollClassName,
    )}
    {...props}
  />
);

export type ConversationEmptyStateProps = ComponentProps<"div">;

export const ConversationEmptyState = ({
  className,
  ...props
}: ConversationEmptyStateProps) => (
  <div className={cn("flex flex-col", className)} {...props} />
);

export type ConversationScrollButtonProps = ComponentProps<typeof Button>;

export const ConversationScrollButton = ({
  className,
  ...props
}: ConversationScrollButtonProps) => {
  const { isAtBottom, scrollToBottom } = useStickToBottomContext();

  if (isAtBottom) return null;
  return (
    <Button
      aria-label="Scroll to latest"
      className={cn(
        "absolute bottom-3 left-1/2 -translate-x-1/2 shadow-[var(--shadow-pop)]",
        className,
      )}
      onClick={() => void scrollToBottom()}
      size="icon-sm"
      type="button"
      variant="outline"
      {...props}
    >
      <ArrowDownIcon />
    </Button>
  );
};
