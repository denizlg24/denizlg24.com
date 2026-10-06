import { cn } from "@repo/ui/utils";
import { ArrowRight } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";

export const container = "mx-auto w-full max-w-6xl px-5 sm:px-6 lg:px-8";

export const ANDROID_APK_HREF = "/android/Macros.apk";

export const sitePages = [
  { href: "/", label: "Overview" },
  { href: "/features", label: "Features" },
  { href: "/coach", label: "Coach" },
  { href: "/download", label: "Download" },
  { href: "/changelog", label: "Changelog" },
] as const;

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

/** The protein, carbs and fat split from the app icon, as a short rule. */
export function MacroRule({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn("flex h-[3px] w-9 flex-none gap-[3px]", className)}
    >
      <span className="flex-[23] rounded-full bg-macro-protein" />
      <span className="flex-[55] rounded-full bg-macro-carbs" />
      <span className="flex-[22] rounded-full bg-macro-fat" />
    </span>
  );
}

const footerLink =
  "text-muted-foreground transition-colors hover:text-foreground";

export function SiteFooter() {
  const columns = [
    { title: "Macros", links: sitePages },
    {
      title: "Get the app",
      links: [
        { href: ANDROID_APK_HREF, label: "Android APK" },
        { href: "/download#iphone", label: "iPhone availability" },
        { href: "/download#faq", label: "Questions" },
      ],
    },
    {
      title: "Legal",
      links: [
        { href: "/terms", label: "Terms" },
        { href: "/privacy", label: "Privacy" },
        { href: "/support", label: "Support" },
        { href: "/account/delete", label: "Delete account" },
      ],
    },
  ] as const;

  return (
    <footer className="border-t">
      <div className={cn(container, "pt-14 pb-10 sm:pt-16")}>
        <div className="grid gap-12 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-20">
          <div className="flex max-w-sm flex-col gap-5">
            <Link
              href="/"
              className="-m-1 flex w-fit items-center gap-3 rounded-lg p-1"
              aria-label="Macros home"
            >
              <AppIcon size={36} />
              <span className="text-lg font-semibold tracking-tight">
                Macros
              </span>
            </Link>
            <p className="text-[15px] leading-relaxed text-muted-foreground text-pretty">
              Nutrition tracking for iPhone and Android. Know what you eat,
              learn what you burn.
            </p>
            <p className="flex items-center gap-2.5 text-sm font-medium">
              <MacroRule />
              On Android now · iPhone in preparation
            </p>
          </div>
          <nav
            aria-label="Footer"
            className="grid grid-cols-2 gap-x-6 gap-y-10 sm:grid-cols-3"
          >
            {columns.map((column) => (
              <div key={column.title}>
                <h2 className="eyebrow">{column.title}</h2>
                <ul className="mt-4 flex flex-col gap-3 text-[15px]">
                  {column.links.map((link) => (
                    <li key={link.href}>
                      {/* The APK is a file stream; a prefetching Link would download it. */}
                      {link.href === ANDROID_APK_HREF ? (
                        <a href={link.href} className={footerLink}>
                          {link.label}
                        </a>
                      ) : (
                        <Link href={link.href} className={footerLink}>
                          {link.label}
                        </Link>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </nav>
        </div>
        <p className="mt-14 border-t pt-6 text-sm text-muted-foreground">
          Built by{" "}
          <a
            href="https://denizlg24.com"
            className="font-medium text-foreground underline decoration-border underline-offset-4 transition-colors hover:decoration-foreground"
          >
            denizlg24.com
          </a>
        </p>
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

export const secondaryButton =
  "inline-flex h-12 items-center justify-center gap-2.5 rounded-[14px] px-5 text-[15px] font-semibold shadow-[inset_0_0_0_1px_var(--border)] transition-[background-color,scale] hover:bg-foreground/5 active:scale-[0.98]";

/** A text link that leads somewhere deeper on the site. */
export function MoreLink({
  href,
  children,
  className,
}: {
  href: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "group flex w-fit items-center gap-1.5 text-[15px] font-semibold underline decoration-border underline-offset-[6px] transition-colors hover:decoration-foreground",
        className,
      )}
    >
      {children}
      <ArrowRight
        aria-hidden="true"
        className="size-4 transition-transform group-hover:translate-x-0.5 motion-reduce:transition-none"
        strokeWidth={2.4}
      />
    </Link>
  );
}

/** Android downloads today; iPhone waits for its public release. */
export function GetTheApp({ className }: { className?: string }) {
  return (
    <div className={cn("flex flex-wrap items-center gap-3", className)}>
      <a href={ANDROID_APK_HREF} className={primaryButton}>
        Download for Android
      </a>
      <Link href="/download#iphone" className={secondaryButton}>
        <span
          aria-hidden="true"
          className="size-2 rounded-full bg-foreground/35"
        />
        iPhone availability
      </Link>
    </div>
  );
}
