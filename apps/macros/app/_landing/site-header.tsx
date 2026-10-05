"use client";

import { cn } from "@repo/ui/utils";
import { Menu, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { AppIcon, container, GetTheApp, sitePages } from "@/app/_landing/site";

const DESKTOP_NAV = sitePages.filter(
  (page) => page.href === "/features" || page.href === "/coach",
);

function currentFor(pathname: string, href: string) {
  return pathname === href ? "page" : undefined;
}

export function SiteHeader() {
  const pathname = usePathname();
  // Remembering which page the menu was opened on closes it on navigation
  // without an effect that has to watch the path.
  const [menuOpenOn, setMenuOpenOn] = useState<string | null>(null);
  const open = menuOpenOn === pathname;
  const panelId = useId();
  const toggle = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = () => setMenuOpenOn(null);
    const root = document.documentElement;
    const previousOverflow = root.style.overflow;
    root.style.overflow = "hidden";

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      close();
      toggle.current?.focus();
    };
    const wide = window.matchMedia("(min-width: 640px)");
    const onWide = (event: MediaQueryListEvent) => {
      if (event.matches) close();
    };

    window.addEventListener("keydown", onKeyDown);
    wide.addEventListener("change", onWide);
    return () => {
      root.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
      wide.removeEventListener("change", onWide);
    };
  }, [open]);

  const closeMenu = () => setMenuOpenOn(null);

  return (
    <>
      <header
        className="site-header sticky top-0 z-50 bg-background/80 backdrop-blur-xl backdrop-saturate-150"
        data-menu-open={open}
      >
        <div className={cn(container, "flex h-14 items-center gap-2 sm:h-16")}>
          <Link
            href="/"
            className="-m-1 mr-auto flex items-center gap-2.5 rounded-lg p-1"
            aria-label="Macros home"
            aria-current={currentFor(pathname, "/")}
            onClick={closeMenu}
          >
            <AppIcon size={28} eager />
            <span className="text-[15px] font-semibold tracking-tight">
              Macros
            </span>
          </Link>
          <nav aria-label="Main" className="mr-2 hidden sm:block">
            <ul className="flex items-center gap-1">
              {DESKTOP_NAV.map((page) => (
                <li key={page.href}>
                  <Link
                    href={page.href}
                    aria-current={currentFor(pathname, page.href)}
                    className="rounded-full px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground aria-[current=page]:font-medium aria-[current=page]:text-foreground"
                  >
                    {page.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
          <Link
            href="/download"
            aria-current={currentFor(pathname, "/download")}
            onClick={closeMenu}
            className="inline-flex h-9 items-center rounded-full bg-foreground px-4 text-sm font-semibold text-background transition-opacity hover:opacity-85"
          >
            Get Macros
          </Link>
          <button
            ref={toggle}
            type="button"
            aria-label="Menu"
            aria-expanded={open}
            aria-controls={panelId}
            onClick={() => setMenuOpenOn(open ? null : pathname)}
            className="-mr-2 flex size-10 items-center justify-center rounded-full transition-colors hover:bg-foreground/6 sm:hidden"
          >
            {open ? (
              <X aria-hidden="true" className="size-5" strokeWidth={2.2} />
            ) : (
              <Menu aria-hidden="true" className="size-5" strokeWidth={2.2} />
            )}
          </button>
        </div>
      </header>

      {/* Outside the header: its backdrop filter would make it the box a
          fixed child is positioned against. */}
      <div
        id={panelId}
        hidden={!open}
        className="menu-panel fixed inset-x-0 top-14 bottom-0 z-40 overflow-y-auto border-t bg-background sm:hidden"
      >
        <div className={cn(container, "flex min-h-full flex-col pt-4 pb-10")}>
          <nav aria-label="Main">
            <ul className="flex flex-col">
              {sitePages.map((page) => (
                <li key={page.href} className="border-b">
                  <Link
                    href={page.href}
                    aria-current={currentFor(pathname, page.href)}
                    onClick={closeMenu}
                    className="flex items-center justify-between py-4 text-[1.75rem] leading-tight font-semibold tracking-[-0.03em] text-muted-foreground transition-colors hover:text-foreground aria-[current=page]:text-foreground"
                  >
                    {page.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
          <div onClick={closeMenu}>
            <GetTheApp className="mt-10 [&>*]:w-full" />
          </div>
          <ul className="mt-auto flex gap-6 pt-10 text-sm text-muted-foreground">
            <li>
              <Link
                href="/terms"
                onClick={closeMenu}
                className="hover:text-foreground"
              >
                Terms
              </Link>
            </li>
            <li>
              <Link
                href="/privacy"
                onClick={closeMenu}
                className="hover:text-foreground"
              >
                Privacy
              </Link>
            </li>
          </ul>
        </div>
      </div>
    </>
  );
}
