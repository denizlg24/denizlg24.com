import { cn } from "@repo/ui/utils";
import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";

export const container = "mx-auto w-full max-w-6xl px-4 sm:px-6 lg:px-8";

export function AppIcon({
  size,
  className,
  eager = false,
}: {
  size: number;
  className?: string;
  eager?: boolean;
}) {
  return (
    <Image
      src="/icon-192.png"
      alt=""
      width={size}
      height={size}
      loading={eager ? "eager" : "lazy"}
      // The icon is opaque, so its own background is the placeholder it
      // paints over: same size, same corners, nothing to swap out.
      className={cn(
        "flex-none rounded-[22.5%] bg-ios-tertiary-fill shadow-[0_0_0_0.5px_rgb(0_0_0/0.12)] dark:shadow-[0_0_0_0.5px_rgb(255_255_255/0.16)]",
        className,
      )}
    />
  );
}

export function SiteHeader() {
  return (
    <header className="site-header sticky top-0 z-50 bg-background/80 backdrop-blur-xl backdrop-saturate-150">
      <div className={cn(container, "flex h-14 items-center justify-between")}>
        <Link
          href="/"
          className="-m-1 flex items-center gap-2.5 rounded-lg p-1"
          aria-label="Macros home"
        >
          <AppIcon size={28} eager />
          <span className="text-[15px] font-semibold tracking-tight">
            Macros
          </span>
        </Link>
        <nav aria-label="Main" className="flex items-center gap-1 sm:gap-2">
          <Link
            href="/#features"
            className="hidden rounded-full px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground sm:block"
          >
            Features
          </Link>
          <Link
            href="/#coming-soon"
            className="ml-1 inline-flex h-9 items-center rounded-full bg-foreground px-4 text-sm font-semibold text-background transition-opacity hover:opacity-85"
          >
            Coming soon
          </Link>
        </nav>
      </div>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="border-t">
      <div
        className={cn(
          container,
          "flex flex-col gap-6 py-10 text-sm sm:flex-row sm:items-center sm:justify-between",
        )}
      >
        <div className="flex items-center gap-3">
          <AppIcon size={24} />
          <p className="text-muted-foreground">
            <span className="font-semibold text-foreground">Macros</span> ·
            Built by{" "}
            <a
              href="https://denizlg24.com"
              className="font-medium text-foreground underline decoration-border underline-offset-4 transition-colors hover:decoration-foreground"
            >
              denizlg24.com
            </a>
          </p>
        </div>
        <nav aria-label="Footer">
          <ul className="flex flex-wrap gap-x-6 gap-y-2 text-muted-foreground">
            <li>
              <Link href="/terms" className="hover:text-foreground">
                Terms
              </Link>
            </li>
            <li>
              <Link href="/privacy" className="hover:text-foreground">
                Privacy
              </Link>
            </li>
          </ul>
        </nav>
      </div>
    </footer>
  );
}

export function SectionLabel({
  index,
  children,
  className,
}: {
  index?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <p className={cn("eyebrow flex items-center gap-3", className)}>
      {index ? (
        <span className="font-figure tracking-normal text-foreground">
          {index}
        </span>
      ) : null}
      <span>{children}</span>
      <span aria-hidden="true" className="h-px flex-1 bg-border" />
    </p>
  );
}

export const primaryButton =
  "inline-flex h-12 items-center justify-center gap-2 rounded-[14px] bg-foreground px-6 text-[15px] font-semibold text-background transition-[opacity,scale] hover:opacity-85 active:scale-[0.98]";

/** Where the download button will go once the app is out. */
export function ComingSoonBadge({ className }: { className?: string }) {
  return (
    <p
      className={cn(
        "inline-flex h-12 items-center gap-2.5 rounded-[14px] bg-foreground/6 px-5 text-[15px] font-semibold",
        className,
      )}
    >
      <span
        aria-hidden="true"
        className="size-2 rounded-full bg-foreground/40"
      />
      Coming soon to iPhone
    </p>
  );
}
