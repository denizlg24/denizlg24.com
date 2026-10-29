"use client";

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
        className="rounded-[2px] bg-status-warning/30 text-accent-strong"
      >
        {part}
      </mark>
    ) : (
      part
    ),
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
