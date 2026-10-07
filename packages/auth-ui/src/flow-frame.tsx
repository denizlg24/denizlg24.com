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
export interface FlowApp {
  name: string;
  logoUrl: string | null;
}

export function FlowFrame({
  destination,
  app,
  themeToggle,
  children,
}: {
  /** `null` or omitted hides the line; `"pending"` holds its place while it resolves. */
  destination?: Destination | "pending" | null;
  /**
   * Someone else's app the visitor is signing in to. Its mark sits over the
   * step so it is clear whose account screen this is not: deniz auth stays
   * in the strip.
   */
  app?: FlowApp | null;
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
        <div className="w-full max-w-[26rem]">
          {app ? <AppMark app={app} /> : null}
          <div className="auth-flow-step">{children}</div>
        </div>
      </main>
      <footer className="px-5 pb-8 sm:px-8">
        <div className="mx-auto w-full max-w-[26rem] border-t pt-4">
          <DestinationLine destination={destination ?? null} />
        </div>
      </footer>
    </div>
  );
}

function AppMark({ app }: { app: FlowApp }) {
  return (
    <div className="mb-8 flex items-center gap-3">
      {app.logoUrl ? (
        // A tenant's logo is an arbitrary external URL; next/image would need
        // every host allow-listed.
        // biome-ignore lint/performance/noImgElement: see above
        <img
          src={app.logoUrl}
          alt=""
          width={32}
          height={32}
          referrerPolicy="no-referrer"
          className="size-8 rounded-md object-cover"
        />
      ) : (
        <span
          aria-hidden="true"
          className="flex size-8 items-center justify-center rounded-md bg-muted text-sm font-semibold text-accent-strong"
        >
          {app.name.slice(0, 1).toUpperCase()}
        </span>
      )}
      <span className="text-sm font-medium text-accent-strong">{app.name}</span>
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
