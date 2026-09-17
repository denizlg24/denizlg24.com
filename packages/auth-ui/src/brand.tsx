import { cn } from "@repo/ui/utils";
import type { ComponentProps } from "react";

/**
 * The pixel padlock from `apps/auth/app/icon.png`, read on a 16-cell grid and
 * cropped to its 10×12 bounding box. The source's cells are jittered by up to
 * a third of a cell and the shackle sits half a cell right of the body's axis,
 * so this is the regularised, symmetric reading rather than a pixel trace:
 * the same three-step arch, three-cell hole, keyhole and one-cell drop shadow.
 *
 * `#` outline and shadow, `o` body, `.` ground (transparent).
 */
const GRID = [
  "....###.....",
  "...#ooo#....",
  "..#o###o#...",
  "..#o###o#...",
  ".##o###o##..",
  ".#ooooooo##.",
  ".#oo###oo##.",
  ".#ooo#ooo##.",
  ".#ooo#ooo##.",
  ".#ooooooo##.",
  ".##########.",
  "..########..",
];

interface Run {
  x: number;
  y: number;
  width: number;
}

function runsOf(symbol: string): Run[] {
  const runs: Run[] = [];
  GRID.forEach((row, y) => {
    let start = -1;
    for (let x = 0; x <= row.length; x++) {
      const on = x < row.length && row[x] === symbol;
      if (on && start === -1) start = x;
      if (!on && start !== -1) {
        runs.push({ x: start, y, width: x - start });
        start = -1;
      }
    }
  });
  return runs;
}

const OUTLINE = runsOf("#");
const BODY = runsOf("o");

export function BrandMark({ className, ...props }: ComponentProps<"svg">) {
  return (
    <svg
      viewBox="0 0 12 12"
      shapeRendering="crispEdges"
      aria-hidden="true"
      className={cn("size-6 shrink-0", className)}
      {...props}
    >
      <g fill="var(--accent-strong)">
        {OUTLINE.map((run) => (
          <rect
            key={`${run.x},${run.y}`}
            x={run.x}
            y={run.y}
            width={run.width}
            height={1}
          />
        ))}
      </g>
      <g fill="var(--accent)">
        {BODY.map((run) => (
          <rect
            key={`${run.x},${run.y}`}
            x={run.x}
            y={run.y}
            width={run.width}
            height={1}
          />
        ))}
      </g>
    </svg>
  );
}

export function Wordmark({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "text-sm font-semibold tracking-tight text-accent-strong",
        className,
      )}
    >
      deniz<span className="text-muted-foreground">auth</span>
    </span>
  );
}

/** Mark and wordmark together; `href` makes it a link (the strip's home). */
export function Brand({
  href,
  className,
}: {
  href?: string;
  className?: string;
}) {
  const content = (
    <>
      <BrandMark />
      <Wordmark />
    </>
  );
  const classes = cn("inline-flex items-center gap-2", className);
  if (href) {
    return (
      <a
        href={href}
        aria-label="deniz auth"
        className={cn(
          classes,
          "rounded-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
        )}
      >
        {content}
      </a>
    );
  }
  return <span className={classes}>{content}</span>;
}
