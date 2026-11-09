"use client";

import { X } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { type ReactNode, useEffect, useRef } from "react";

/**
 * The details modal over whatever page opened it. The page behind goes
 * inert (so a remote's arrows stay inside) and stops scrolling; Escape,
 * the close button and a click outside all go back.
 */
export function TitleModal({
  titleId,
  children,
}: {
  titleId: string;
  children: ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const open = pathname === `/title/${titleId}`;
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const page = document.getElementById("page");
    const root = document.documentElement;
    const overflow = root.style.overflow;
    page?.setAttribute("inert", "");
    root.style.overflow = "hidden";
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented) router.back();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      page?.removeAttribute("inert");
      root.style.overflow = overflow;
      document.removeEventListener("keydown", onKey);
    };
  }, [open, router]);

  // The details stream in after the frame, so wait for Play to exist.
  useEffect(() => {
    if (!open || !panel.current) return;
    const root = panel.current;
    const tryFocus = () => {
      const target = root.querySelector<HTMLElement>("[data-nav-autofocus]");
      if (!target) return false;
      if (
        !root.contains(document.activeElement) ||
        document.activeElement === root.querySelector("[aria-label='Close']")
      ) {
        target.focus({ preventScroll: true });
      }
      return true;
    };
    root
      .querySelector<HTMLElement>("[data-nav]")
      ?.focus({ preventScroll: true });
    if (tryFocus()) return;
    const observer = new MutationObserver(() => {
      if (tryFocus()) observer.disconnect();
    });
    observer.observe(root, { childList: true, subtree: true });
    const timer = window.setTimeout(() => observer.disconnect(), 8000);
    return () => {
      observer.disconnect();
      window.clearTimeout(timer);
    };
  }, [open]);

  if (!open) return null;
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="title-heading"
      onClick={(event) => {
        if (event.target === event.currentTarget) router.back();
      }}
      className="fixed inset-0 z-50 overflow-y-auto overscroll-contain bg-ink/75 sm:px-4 md:py-8"
    >
      <div
        ref={panel}
        className="relative mx-auto min-h-full w-full max-w-[57rem] overflow-hidden bg-raised shadow-[0_24px_80px_rgb(0_0_0/0.8)] animate-rise sm:min-h-0 sm:rounded-md"
      >
        <div className="sticky top-0 z-20 h-0">
          <button
            type="button"
            data-nav
            aria-label="Close"
            onClick={() => router.back()}
            className="absolute top-3 right-3 grid size-10 place-items-center rounded-full bg-raised/90 text-paper transition-colors hover:bg-lift md:top-4 md:right-4"
          >
            <X className="size-6" strokeWidth={2} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
