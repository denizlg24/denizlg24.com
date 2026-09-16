"use client";

import { Separator } from "@repo/ui/separator";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function HighlightedText({
  text,
  terms,
}: {
  text: string;
  terms: readonly string[];
}) {
  if (terms.length === 0) return text;
  const pattern = new RegExp(`(${terms.map(escapeRegExp).join("|")})`, "gi");
  // A capturing split puts every match at an odd index.
  return text.split(pattern).map((part, index) =>
    index % 2 === 1 ? (
      <mark
        key={index}
        className="rounded-[2px] bg-amber-400/30 text-foreground dark:bg-amber-300/25"
      >
        {part}
      </mark>
    ) : (
      part
    ),
  );
}

export function SectionHeading({
  title,
  meta,
  className,
}: {
  title: ReactNode;
  meta?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex items-center gap-3", className)}>
      <h2 className="shrink-0 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </h2>
      <Separator className="flex-1" />
      {meta !== undefined && (
        <span className="shrink-0 font-mono text-[10px] tabular-nums text-muted-foreground">
          {meta}
        </span>
      )}
    </div>
  );
}

export function ContextDot({ color }: { color?: string }) {
  return (
    <span
      className="size-1.5 shrink-0 rounded-full bg-muted-foreground/60"
      style={color ? { backgroundColor: color } : undefined}
    />
  );
}
