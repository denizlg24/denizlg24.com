import type { ReactNode } from "react";
import { cn } from "./utils";

/**
 * List on the left, the selected record on the right — the layout for inbox,
 * notes, people, journal. Below `md` only one pane shows: the list until
 * something is selected (`detailOpen`), then the detail.
 */
export function SplitView({
  list,
  detail,
  detailOpen,
  listWidth = "md:w-80",
  className,
}: {
  list: ReactNode;
  detail: ReactNode;
  detailOpen: boolean;
  /** `md:`-prefixed width class for the list pane; below `md` it is full width. */
  listWidth?: string;
  className?: string;
}) {
  return (
    <div className={cn("flex min-h-0 flex-1 overflow-hidden", className)}>
      <div
        className={cn(
          "min-h-0 w-full shrink-0 flex-col overflow-hidden md:flex md:border-r",
          listWidth,
          detailOpen ? "hidden" : "flex",
        )}
      >
        {list}
      </div>
      <div
        className={cn(
          "min-h-0 min-w-0 flex-1 flex-col overflow-hidden md:flex",
          detailOpen ? "flex" : "hidden",
        )}
      >
        {detail}
      </div>
    </div>
  );
}

/** The list pane's own scroll region with a sticky header slot. */
export function SplitList({
  header,
  className,
  children,
}: {
  header?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <>
      {header ? (
        <div className="flex shrink-0 flex-col gap-2 border-b p-2">
          {header}
        </div>
      ) : null}
      <div
        className={cn(
          "min-h-0 flex-1 overflow-y-auto overscroll-contain p-2",
          className,
        )}
      >
        {children}
      </div>
    </>
  );
}
