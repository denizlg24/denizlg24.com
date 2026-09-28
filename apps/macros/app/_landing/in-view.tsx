"use client";

import { type ReactNode, useEffect, useRef, useState } from "react";

/**
 * Marks its subtree `data-active` the first time it scrolls into view, which
 * is what the screen animations key on. Until then (and without JavaScript)
 * the static final state is what renders.
 */
export function InView({
  children,
  className,
  threshold = 0.35,
}: {
  children: ReactNode;
  className?: string;
  threshold?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(false);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return;
        setActive(true);
        observer.disconnect();
      },
      { threshold },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [threshold]);

  return (
    <div ref={ref} className={className} data-active={active}>
      {children}
    </div>
  );
}
