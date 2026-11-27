"use client";

import { useRef } from "react";
import { cn } from "@/lib/utils";
import { useMotion } from "./motion";

export const markPath = "M10 21L18.5 45L31 27L43.5 45L52 21";
export const markPoints = [
  [10, 21],
  [18.5, 45],
  [31, 27],
  [43.5, 45],
  [52, 21],
] as const;

/** Share of the W's length (pathLength 100) that ends at the second trough. */
const secondTrough = 73.13;
/** Hides the dash, round cap included, before the first draw. */
const hidden = 106;

/**
 * The W mark that draws itself: the line runs left to right, the last-print
 * dot lands amber, pulses once and settles to the mark colour. Hovering the
 * nearest `[data-mark-hover]` ancestor redraws from the second trough.
 */
export function AnimatedMark({
  size = 24,
  trigger = "load",
  delay = 0.1,
  className,
}: {
  size?: number;
  trigger?: "load" | "view";
  delay?: number;
  className?: string;
}) {
  const wrap = useRef<HTMLSpanElement>(null);

  useMotion(wrap, ({ motion }, { gsap, ScrollTrigger }) => {
    const root = wrap.current;
    const line = root?.querySelector("path");
    const dot = root?.querySelector("circle");
    if (!root || !line || !dot || !motion) return;

    const settled = getComputedStyle(root).color;
    const amber = getComputedStyle(root).getPropertyValue("--mk-amber").trim();
    gsap.set(line, { strokeDasharray: "100 110", strokeDashoffset: hidden });
    gsap.set(dot, {
      scale: 0,
      transformOrigin: "50% 50%",
      fill: amber || "#e3b665",
    });

    const draw = gsap
      .timeline({ paused: true, delay })
      .to(line, { strokeDashoffset: 0, duration: 0.9, ease: "power2.inOut" })
      .to(dot, { scale: 1, duration: 0.22, ease: "power3.out" }, "-=0.08")
      .to(dot, {
        scale: 1.55,
        duration: 0.2,
        ease: "sine.inOut",
        yoyo: true,
        repeat: 1,
      })
      .to(dot, { fill: settled, duration: 0.5, ease: "power1.out" }, "+=0.15");

    if (trigger === "view")
      ScrollTrigger.create({
        trigger: root,
        start: "top 97%",
        once: true,
        onEnter: () => {
          draw.play();
        },
      });
    else draw.play();

    const host = root.closest<HTMLElement>("[data-mark-hover]") ?? root;
    const redraw = () => {
      if (draw.isActive() || draw.progress() < 1) return;
      gsap.fromTo(
        line,
        { strokeDashoffset: 100 - secondTrough },
        { strokeDashoffset: 0, duration: 0.42, ease: "power2.out" },
      );
    };
    host.addEventListener("pointerenter", redraw);
    return () => host.removeEventListener("pointerenter", redraw);
  });

  return (
    <span
      ref={wrap}
      className={cn("mk-mark", className)}
      style={{ width: size, height: (size * 44) / 56 }}
      aria-hidden
    >
      <svg
        viewBox="4 10 56 44"
        width="100%"
        height="100%"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d={markPath} strokeWidth={7} pathLength={100} />
        <circle cx={52} cy={21} r={5.2} fill="currentColor" stroke="none" />
      </svg>
    </span>
  );
}

export function Wordmark({
  size = 22,
  trigger,
}: {
  size?: number;
  trigger?: "load" | "view";
}) {
  return (
    <span className="mk-wordmark">
      <AnimatedMark size={size} trigger={trigger} />
      <span>stockwatcher</span>
    </span>
  );
}
