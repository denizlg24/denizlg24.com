"use client";

import { useRef } from "react";
import { useMotion } from "./motion";

const format = (
  value: number,
  decimals: number,
  { prefix = "", suffix = "", signed = false },
) => {
  const sign = signed
    ? value > 0
      ? "+"
      : value < 0
        ? "−"
        : ""
    : value < 0
      ? "−"
      : "";
  const body = Math.abs(value).toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
  return `${sign}${prefix}${body}${suffix}`;
};

/** A figure that counts up from zero on first view; it renders its final value first. */
export function CountUp({
  value,
  decimals = 0,
  prefix,
  suffix,
  signed,
}: {
  value: number;
  decimals?: number;
  prefix?: string;
  suffix?: string;
  signed?: boolean;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const options = { prefix, suffix, signed };
  const final = format(value, decimals, options);

  useMotion(ref, ({ motion }, { gsap }) => {
    const element = ref.current;
    if (!element || !motion) return;
    const state = { current: 0 };
    element.textContent = format(0, decimals, options);
    gsap.to(state, {
      current: value,
      duration: 1.1,
      ease: "power3.out",
      scrollTrigger: { trigger: element, start: "top 88%", once: true },
      onUpdate: () => {
        element.textContent = format(state.current, decimals, options);
      },
      onComplete: () => {
        element.textContent = final;
      },
    });
    return () => {
      element.textContent = final;
    };
  });

  return (
    <span ref={ref} className="count-up">
      {final}
    </span>
  );
}
