"use client";

import { useRef } from "react";
import { CountUp } from "@/components/marketing/count-up";
import { useMotion } from "@/components/marketing/motion";
import { wire } from "./terminal-data";

export function WireList() {
  const ref = useRef<HTMLDivElement>(null);

  useMotion(ref, ({ motion }, { gsap }) => {
    const root = ref.current;
    if (!root || !motion) return;
    gsap.from(root.querySelectorAll("li"), {
      opacity: 0,
      y: -10,
      duration: 0.5,
      ease: "power3.out",
      stagger: 0.12,
      scrollTrigger: { trigger: root, start: "top 78%", once: true },
    });
  });

  return (
    <div className="wire" ref={ref}>
      <p className="wire-count">
        <span>
          <CountUp value={60} /> stories
        </span>
        <span>
          <CountUp value={18} /> publishers
        </span>
        <span>26–27 Nov 2026</span>
      </p>
      <ol className="wire-list">
        {wire.map((item) => (
          <li key={item.title}>
            <time>{item.time}</time>
            <span className="wire-title">{item.title}</span>
            <span className="wire-meta">
              {item.publisher} <span>{item.symbols}</span>
            </span>
          </li>
        ))}
      </ol>
      <p className="wire-foot">Times UTC · de-duplicated by story</p>
    </div>
  );
}
