"use client";

import { type ReactNode, useRef } from "react";
import { type Tone, tone, useMotion } from "./motion";

const surfaceKeys = new Set(["--mk-bg", "--mk-grid", "--card", "--muted"]);

/**
 * A section whose colours scrub from one tone to another as it scrolls into
 * view. Without motion (or JS) it simply renders in its `to` tone.
 */
export function Turn({
  from,
  to,
  id,
  className,
  labelledBy,
  children,
}: {
  from: Tone;
  to: Tone;
  id?: string;
  className?: string;
  labelledBy?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLElement>(null);

  useMotion(ref, ({ motion }, { gsap }) => {
    const section = ref.current;
    if (!section || !motion) return;
    const split = (name: Tone) => {
      const surface: Record<string, string> = {};
      const ink: Record<string, string> = {};
      for (const [key, value] of Object.entries(tone[name]))
        (surfaceKeys.has(key) ? surface : ink)[key] = value;
      return { surface, ink };
    };
    const start = split(from);
    const end = split(to);
    // The paper scrubs across the whole range; the ink flips over a short
    // window in the middle so text never sits grey on grey for long.
    gsap
      .timeline({
        scrollTrigger: {
          trigger: section,
          start: "top 88%",
          end: "top 30%",
          scrub: 0.4,
        },
      })
      .fromTo(
        section,
        start.surface,
        { ...end.surface, ease: "none", duration: 1 },
        0,
      )
      .fromTo(
        section,
        start.ink,
        { ...end.ink, ease: "none", duration: 0.14 },
        0.43,
      );
  });

  return (
    <section
      ref={ref}
      id={id}
      className={className}
      data-tone={to}
      aria-labelledby={labelledBy}
    >
      {children}
    </section>
  );
}
