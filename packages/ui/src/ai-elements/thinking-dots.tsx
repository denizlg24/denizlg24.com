import type { ComponentProps } from "react";

import { cn } from "../utils";

/**
 * The waiting state: three dots rising in turn.
 *
 * It stands in for a turn that has started and produced nothing yet, so it
 * carries no text. Screen readers get one label instead of three bullets, and
 * `motion-reduce` leaves three static dots rather than nothing at all — the
 * indicator still has to say "working" without the motion.
 */
export const ThinkingDots = ({
  className,
  label = "Thinking",
  ...props
}: ComponentProps<"span"> & { label?: string }) => (
  <span
    data-slot="thinking-dots"
    className={cn(
      "inline-flex items-center gap-[0.22em] align-middle text-muted-foreground",
      className,
    )}
    {...props}
  >
    <span className="sr-only">{label}</span>
    {[0, 1, 2].map((index) => (
      <span
        key={index}
        aria-hidden
        className="thinking-dot size-[0.3em] rounded-full bg-current motion-reduce:animate-none"
        style={{ animationDelay: `${index * 0.14}s` }}
      />
    ))}
  </span>
);
