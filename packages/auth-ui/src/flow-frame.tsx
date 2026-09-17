import { Skeleton } from "@repo/ui/skeleton";
import type { ReactNode } from "react";
import { Brand } from "./brand";
import type { Destination } from "./destination";

/**
 * The frame every flow screen sits in: a top strip with the brand and the
 * theme toggle, a vertically centred column for the step, and the destination
 * line pinned under it. Only the column carries the step transition name, so
 * the strip and the line stay put while a step changes.
 */
export function FlowFrame({
  destination,
  themeToggle,
  children,
}: {
  /** `null` or omitted hides the line; `"pending"` holds its place while it resolves. */
  destination?: Destination | "pending" | null;
  themeToggle?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="flex h-14 shrink-0 items-center justify-between px-5 sm:px-8">
        <Brand />
        {themeToggle}
      </header>
      <main className="flex flex-1 flex-col items-center justify-center px-5 py-8 sm:px-8">
        <div className="auth-flow-step w-full max-w-[26rem]">{children}</div>
      </main>
      <footer className="px-5 pb-8 sm:px-8">
        <div className="mx-auto w-full max-w-[26rem] border-t pt-4">
          <DestinationLine destination={destination ?? null} />
        </div>
      </footer>
    </div>
  );
}

function DestinationLine({
  destination,
}: {
  destination: Destination | "pending" | null;
}) {
  if (destination === "pending") {
    return <Skeleton className="h-4 w-48" aria-label="Loading destination" />;
  }
  if (destination === null) {
    return <p className="text-xs text-muted-foreground">deniz auth</p>;
  }
  return (
    <p className="text-xs text-muted-foreground">
      Continuing to{" "}
      <span className="font-medium text-accent-strong">{destination.name}</span>
      {destination.host ? (
        <>
          {" · "}
          <span className="font-mono">{destination.host}</span>
        </>
      ) : null}
    </p>
  );
}
