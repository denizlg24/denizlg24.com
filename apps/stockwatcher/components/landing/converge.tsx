"use client";

import { useRef } from "react";
import { AnimatedMark } from "@/components/marketing/animated-mark";
import { useMotion } from "@/components/marketing/motion";

const inputs = [
  { name: "SEC EDGAR", note: "Filings, XBRL, Form 4, 13D" },
  { name: "FRED", note: "Every economic series" },
  { name: "U.S. Treasury", note: "Daily yield curve" },
  { name: "Options markets", note: "IV, skew, implied moves" },
  { name: "Fama/French", note: "Factor returns" },
  {
    name: "Interactive Brokers",
    note: "Positions and cash",
    logo: "/brand/interactive-brokers.svg",
  },
  { name: "Your documents", note: "Research, decks, memos" },
  { name: "Market data", note: "Quotes and history" },
] as const;

const outputs = ["Answers", "Charts", "Reports", "Alerts"] as const;

const row = 60;
const height = inputs.length * row;
const middle = height / 2;
const outputRow = height / outputs.length;

const inPath = (index: number) => {
  const y = index * row + row / 2;
  return `M0 ${y} C 140 ${y}, 160 ${middle}, 300 ${middle}`;
};

const outPath = (index: number) => {
  const y = index * outputRow + outputRow / 2;
  return `M0 ${middle} C 90 ${middle}, 110 ${y}, 200 ${y}`;
};

export function Converge() {
  const ref = useRef<HTMLDivElement>(null);

  useMotion(ref, ({ motion }, { gsap }) => {
    const root = ref.current;
    if (!root || !motion) return;
    const trails = root.querySelectorAll<SVGPathElement>(".converge-trail");
    const pulses = root.querySelectorAll<SVGPathElement>(".converge-pulse");
    const sources = root.querySelectorAll(".converge-inputs li");
    const results = root.querySelectorAll(".converge-outputs li");

    gsap
      .timeline({
        scrollTrigger: {
          trigger: root,
          start: "top 80%",
          end: "top 30%",
          scrub: 0.5,
        },
      })
      .from(
        sources,
        { opacity: 0.25, x: -12, stagger: 0.05, ease: "power2.out" },
        0,
      )
      .fromTo(
        trails,
        { strokeDashoffset: 1 },
        { strokeDashoffset: 0, stagger: 0.04, ease: "none" },
        0.1,
      )
      .from(
        results,
        { opacity: 0.25, x: 12, stagger: 0.08, ease: "power2.out" },
        0.55,
      );

    // Signals keep travelling while the section is on screen.
    const signals = gsap.timeline({ repeat: -1, paused: true });
    pulses.forEach((pulse, index) => {
      signals.fromTo(
        pulse,
        { strokeDashoffset: 0.08 },
        { strokeDashoffset: -1, duration: 2.2, ease: "power1.inOut" },
        pulse.dataset.out ? 1.4 + index * 0.05 : index * 0.32,
      );
    });
    gsap.set(pulses, { opacity: 1 });
    const observer = new IntersectionObserver(([entry]) => {
      if (entry?.isIntersecting) signals.play();
      else signals.pause();
    });
    observer.observe(root);
    return () => observer.disconnect();
  });

  return (
    <div className="converge" ref={ref}>
      <ul className="converge-inputs">
        {inputs.map((input) => (
          <li key={input.name}>
            {"logo" in input ? (
              <img src={input.logo} alt={input.name} height={15} />
            ) : (
              <strong>{input.name}</strong>
            )}
            <span>{input.note}</span>
          </li>
        ))}
      </ul>
      <svg
        className="converge-lines"
        viewBox={`0 0 300 ${height}`}
        preserveAspectRatio="none"
        aria-hidden
      >
        {inputs.map((input, index) => (
          <g key={input.name}>
            <path className="converge-trail" d={inPath(index)} pathLength={1} />
            <path className="converge-pulse" d={inPath(index)} pathLength={1} />
          </g>
        ))}
      </svg>
      <div className="converge-core">
        <AnimatedMark size={44} trigger="view" />
        <span>stockwatcher</span>
      </div>
      <svg
        className="converge-lines converge-out"
        viewBox={`0 0 200 ${height}`}
        preserveAspectRatio="none"
        aria-hidden
      >
        {outputs.map((output, index) => (
          <g key={output}>
            <path
              className="converge-trail"
              d={outPath(index)}
              pathLength={1}
            />
            <path
              className="converge-pulse"
              d={outPath(index)}
              pathLength={1}
              data-out="true"
            />
          </g>
        ))}
      </svg>
      <ul className="converge-outputs">
        {outputs.map((output) => (
          <li key={output}>{output}</li>
        ))}
      </ul>
    </div>
  );
}
