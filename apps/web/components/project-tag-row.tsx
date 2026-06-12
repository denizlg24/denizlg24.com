"use client";

import { Badge } from "@repo/ui/badge";
import { useCallback, useLayoutEffect, useRef, useState } from "react";

export function ProjectTagRow({ tags }: { tags: string[] }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const measurementsRef = useRef<HTMLDivElement>(null);
  const tagRefs = useRef<(HTMLSpanElement | null)[]>([]);
  const overflowRefs = useRef<(HTMLSpanElement | null)[]>([]);
  const [visibleCount, setVisibleCount] = useState(0);

  const calculateVisibleCount = useCallback(() => {
    const container = containerRef.current;
    const measurements = measurementsRef.current;

    if (!container || !measurements) {
      return;
    }

    const gap =
      Number.parseFloat(getComputedStyle(measurements).columnGap) || 0;
    const tagWidths = tags.map(
      (_, index) => tagRefs.current[index]?.getBoundingClientRect().width ?? 0,
    );
    let nextVisibleCount = tags.length;

    for (let count = tags.length; count >= 0; count--) {
      const hiddenCount = tags.length - count;
      const tagsWidth = tagWidths
        .slice(0, count)
        .reduce((total, width) => total + width, 0);
      const overflowWidth =
        hiddenCount > 0
          ? (overflowRefs.current[hiddenCount]?.getBoundingClientRect().width ??
            0)
          : 0;
      const itemCount = count + (hiddenCount > 0 ? 1 : 0);
      const requiredWidth = tagsWidth + overflowWidth + gap * (itemCount - 1);

      if (requiredWidth <= container.clientWidth) {
        nextVisibleCount = count;
        break;
      }
    }

    setVisibleCount(nextVisibleCount);
  }, [tags]);

  useLayoutEffect(() => {
    calculateVisibleCount();

    const observer = new ResizeObserver(calculateVisibleCount);

    if (containerRef.current) {
      observer.observe(containerRef.current);
    }

    if (measurementsRef.current) {
      observer.observe(measurementsRef.current);
    }

    return () => observer.disconnect();
  }, [calculateVisibleCount]);

  const hiddenCount = tags.length - visibleCount;

  return (
    <div
      ref={containerRef}
      className="relative flex w-full flex-row items-center justify-start gap-1 overflow-hidden whitespace-nowrap"
    >
      {tags.slice(0, visibleCount).map((tag, index) => (
        <Badge key={`${tag}-${index}`} className="text-xs">
          {tag}
        </Badge>
      ))}
      {hiddenCount > 0 && <Badge className="text-xs">+{hiddenCount}</Badge>}

      <div
        ref={measurementsRef}
        aria-hidden="true"
        className="invisible absolute flex flex-row items-center gap-1 whitespace-nowrap"
      >
        {tags.map((tag, index) => (
          <Badge
            key={`${tag}-${index}`}
            ref={(element) => {
              tagRefs.current[index] = element;
            }}
            className="text-xs"
          >
            {tag}
          </Badge>
        ))}
        {tags.map((_, index) => {
          const count = index + 1;

          return (
            <Badge
              key={count}
              ref={(element) => {
                overflowRefs.current[count] = element;
              }}
              className="text-xs"
            >
              +{count}
            </Badge>
          );
        })}
      </div>
    </div>
  );
}
