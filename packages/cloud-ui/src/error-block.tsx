"use client";

import { CopyButton } from "@repo/ui/copy-button";
import { cn } from "@repo/ui/utils";

/**
 * A failure string that cannot break the layout it lands in.
 *
 * Build errors are whatever the toolchain printed: a Docker step's stderr, a
 * stack trace, a single 900-character line with no spaces in it. Rendered as
 * ordinary text they push the container they sit in past the viewport, and in a
 * dialog that means the footer buttons leave the screen.
 *
 * Three things make that impossible here. `wrap-anywhere` lets the break happen
 * mid-token, so the min-content width is one character rather than the longest
 * word — `break-words` alone does not shrink a flex item. The height is capped
 * and scrolls inside itself instead of growing the page. And the copy button is
 * there because the usual next step with a build error is pasting it somewhere.
 *
 * Callers still owe it a `min-w-0` ancestor if they place it inside a flex row.
 */
export function ErrorBlock({
  message,
  className,
  maxHeightClass = "max-h-40",
  tone = "destructive",
}: {
  message: string;
  className?: string;
  /** How tall it gets before it scrolls. */
  maxHeightClass?: string;
  /** `inherit` inside a callout that already carries the failure's colour. */
  tone?: "destructive" | "muted" | "inherit";
}) {
  return (
    <div className={cn("flex min-w-0 items-start gap-1", className)}>
      <pre
        className={cn(
          "min-w-0 flex-1 overflow-auto whitespace-pre-wrap wrap-anywhere font-mono text-[11px] leading-4",
          tone === "destructive" && "text-destructive",
          tone === "muted" && "text-muted-foreground",
          maxHeightClass,
        )}
      >
        {message}
      </pre>
      <CopyButton
        value={message}
        label="Copy error"
        className="size-6 text-muted-foreground"
      />
    </div>
  );
}
