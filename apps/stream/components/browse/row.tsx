"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

interface Paging {
  page: number;
  pages: number;
}

function measure(scroller: HTMLElement): Paging & { step: number } {
  const style = getComputedStyle(scroller);
  const padding =
    Number.parseFloat(style.paddingLeft) +
    Number.parseFloat(style.paddingRight);
  const gap = Number.parseFloat(style.columnGap) || 0;
  const step = Math.max(1, scroller.clientWidth - padding + gap);
  const content = scroller.scrollWidth - padding + gap;
  const pages = Math.max(1, Math.round(content / step));
  const atEnd =
    scroller.scrollLeft + scroller.clientWidth >= scroller.scrollWidth - 4;
  const page = atEnd
    ? pages - 1
    : Math.min(pages - 1, Math.round(scroller.scrollLeft / step));
  return { page, pages, step };
}

/**
 * A row of tiles that pages a screen at a time: edge arrows and a page
 * indicator for a mouse, swipe on touch, and arrow-key focus on a TV (the
 * focused tile scrolls into view). The scrollbar is hidden, and the row
 * never widens the page.
 */
export function Row({
  label,
  more,
  children,
}: {
  label: string;
  more?: string | null;
  children: ReactNode;
}) {
  const scroller = useRef<HTMLUListElement>(null);
  const [paging, setPaging] = useState<Paging>({ page: 0, pages: 1 });

  const update = useCallback(() => {
    if (!scroller.current) return;
    const { page, pages } = measure(scroller.current);
    setPaging((current) =>
      current.page === page && current.pages === pages
        ? current
        : { page, pages },
    );
  }, []);

  useEffect(() => {
    const element = scroller.current;
    if (!element) return;
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    element.addEventListener("scroll", update, { passive: true });
    // A remote moves focus one tile at a time. A tile that falls off screen
    // becomes the row's first: snapping would undo any other alignment.
    const onFocus = (event: FocusEvent) => {
      const tile =
        event.target instanceof Element ? event.target.closest("li") : null;
      if (!tile || tile.parentElement !== element) return;
      const style = getComputedStyle(element);
      const start = Number.parseFloat(style.paddingLeft);
      const end = element.clientWidth - Number.parseFloat(style.paddingRight);
      const left = tile.offsetLeft - element.scrollLeft;
      const right = left + tile.offsetWidth;
      if (left >= start - 1 && right <= end + 1) return;
      element.scrollTo({ left: tile.offsetLeft - start, behavior: "smooth" });
    };
    element.addEventListener("focusin", onFocus);
    return () => {
      observer.disconnect();
      element.removeEventListener("scroll", update);
      element.removeEventListener("focusin", onFocus);
    };
  }, [update]);

  const go = (direction: -1 | 1) => {
    const element = scroller.current;
    if (!element) return;
    const { step } = measure(element);
    element.scrollBy({ left: direction * step, behavior: "smooth" });
  };

  const canBack = paging.page > 0;
  const canForward = paging.page < paging.pages - 1;
  const arrow =
    "hover-only absolute inset-y-0 z-20 grid w-[var(--gutter)] place-items-center overflow-hidden bg-ink/55 text-paper opacity-0 transition-opacity duration-200 group-hover/row:opacity-100 hover:bg-ink/75 focus-visible:opacity-100 [&>svg]:transition-transform hover:[&>svg]:scale-125";

  return (
    <section className="group/row relative" aria-label={label}>
      <div className="flex items-end justify-between gap-4 px-[var(--gutter)] pb-2">
        <h2 className="min-w-0 truncate text-[clamp(1rem,1.25vw+0.5rem,1.6rem)] font-bold">
          {more ? (
            <Link
              href={more}
              data-nav
              className="group/more inline-flex max-w-full items-baseline gap-2 rounded"
            >
              <span className="truncate">{label}</span>
              <span className="inline-flex shrink-0 items-center text-[0.8rem] font-bold text-amber opacity-0 transition-opacity group-hover/row:opacity-100 group-focus-visible/more:opacity-100 [@media(hover:none)]:opacity-100">
                Explore all
                <ChevronRight className="size-4" aria-hidden />
              </span>
            </Link>
          ) : (
            label
          )}
        </h2>
        {paging.pages > 1 ? (
          <div
            aria-hidden
            className="hover-only flex shrink-0 gap-0.5 pb-1 opacity-0 transition-opacity group-hover/row:opacity-100"
          >
            {Array.from({ length: paging.pages }, (_, index) => (
              <span
                key={index}
                className={`h-0.5 w-3 ${index === paging.page ? "bg-paper" : "bg-paper/25"}`}
              />
            ))}
          </div>
        ) : null}
      </div>
      <div className="relative">
        <ul ref={scroller} className="row-scroller -my-2 py-2">
          {children}
        </ul>
        {canBack ? (
          <button
            type="button"
            tabIndex={-1}
            aria-label={`Back: ${label}`}
            onClick={() => go(-1)}
            className={`${arrow} left-0 rounded-r-[4px]`}
          >
            <ChevronLeft
              className="size-[min(2rem,var(--gutter))]"
              strokeWidth={2.5}
            />
          </button>
        ) : null}
        {canForward ? (
          <button
            type="button"
            tabIndex={-1}
            aria-label={`More: ${label}`}
            onClick={() => go(1)}
            className={`${arrow} right-0 rounded-l-[4px]`}
          >
            <ChevronRight
              className="size-[min(2rem,var(--gutter))]"
              strokeWidth={2.5}
            />
          </button>
        ) : null}
      </div>
    </section>
  );
}
