"use client";

import { useRef } from "react";
import { markPath } from "@/components/marketing/animated-mark";
import { useMotion } from "@/components/marketing/motion";

type Point = { x: number; y: number };

function seeded(seed: number) {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A price walk from the left edge that lands exactly on `end`. */
function walk(end: Point, amplitude: number): Point[] {
  const random = seeded(20261127);
  const step = 22;
  const count = Math.max(4, Math.ceil(end.x / step));
  const points: Point[] = [];
  let drift = 0;
  for (let index = 0; index <= count; index++) {
    const t = index / count;
    drift += (random() - 0.48) * amplitude * 0.42;
    drift = Math.max(-amplitude / 2, Math.min(amplitude / 2, drift));
    const settle = 1 - t ** 4;
    points.push({
      x: t * end.x,
      y: end.y - amplitude * 0.45 * settle + drift * settle,
    });
  }
  return points;
}

const toPath = (points: Point[]) =>
  points
    .map(
      (point, index) =>
        `${index ? "L" : "M"}${point.x.toFixed(1)} ${point.y.toFixed(1)}`,
    )
    .join("");

/**
 * The hero's price line: it draws across the viewport, resolves into the W
 * at `[data-hero-w]` and leans toward the pointer once drawn.
 */
export function HeroLine() {
  const wrap = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const runRef = useRef<SVGPathElement>(null);
  const markRef = useRef<SVGGElement>(null);

  useMotion(wrap, ({ motion, wide, fine }, { gsap }) => {
    const root = wrap.current;
    const svg = svgRef.current;
    const run = runRef.current;
    const mark = markRef.current;
    const hero = root?.parentElement;
    const anchor = hero?.querySelector<HTMLElement>("[data-hero-w]");
    if (!root || !svg || !run || !mark || !hero || !anchor) return;
    const line = mark.querySelector("path");
    const dot = mark.querySelector("circle");
    if (!line || !dot) return;

    let base: Point[] = [];
    let end: Point = { x: 0, y: 0 };

    const measure = () => {
      const box = root.getBoundingClientRect();
      const target = anchor.getBoundingClientRect();
      if (!box.width || !target.width) return;
      const scale = target.width / 56;
      const left = target.left - box.left;
      const top = target.top - box.top;
      end = { x: left + 6 * scale, y: top + 11 * scale };
      svg.setAttribute("viewBox", `0 0 ${box.width} ${box.height}`);
      mark.setAttribute(
        "transform",
        `translate(${left - 4 * scale} ${top - 10 * scale}) scale(${scale})`,
      );
      base = walk(end, Math.min(72, Math.max(36, end.y * 0.55)));
      run.setAttribute("d", toPath(base));
    };
    measure();
    root.dataset.ready = "true";

    const observer = new ResizeObserver(() => {
      measure();
      bend();
    });
    observer.observe(root);
    observer.observe(anchor);

    const amber = getComputedStyle(root).getPropertyValue("--mk-amber").trim();
    const settled = getComputedStyle(root).color;
    let drawn = !motion;

    if (motion) {
      const length = run.getTotalLength();
      gsap.set(run, { strokeDasharray: length, strokeDashoffset: length });
      gsap.set(line, { strokeDasharray: "100 110", strokeDashoffset: 106 });
      gsap.set(dot, { scale: 0, transformOrigin: "50% 50%", fill: amber });
      gsap
        .timeline({
          delay: 0.25,
          onComplete: () => {
            drawn = true;
            gsap.set(run, { clearProps: "strokeDasharray,strokeDashoffset" });
          },
        })
        .to(run, { strokeDashoffset: 0, duration: 1.3, ease: "power1.inOut" })
        .to(line, {
          strokeDashoffset: 0,
          duration: 0.9,
          ease: "power2.inOut",
        })
        .to(dot, { scale: 1, duration: 0.22, ease: "power3.out" }, "-=0.08")
        .to(dot, {
          scale: 1.5,
          duration: 0.22,
          ease: "sine.inOut",
          yoyo: true,
          repeat: 1,
        })
        .to(dot, { fill: settled, duration: 0.6 }, "+=0.2");
    }

    // Pointer lean: cheap, one path rebuild per frame and only while moving.
    const pointer = { x: 0, y: 0, strength: 0, target: 0 };
    let frame = 0;
    function bend() {
      if (!pointer.strength) {
        run?.setAttribute("d", toPath(base));
        return;
      }
      const bent = base.map((point) => {
        const reach = Math.exp(-((point.x - pointer.x) ** 2) / (2 * 170 ** 2));
        const anchorFade = Math.min(1, Math.max(0, (end.x - point.x) / 140));
        const pull = Math.max(-38, Math.min(38, (pointer.y - point.y) * 0.22));
        return {
          x: point.x,
          y: point.y + pull * reach * anchorFade * pointer.strength,
        };
      });
      run?.setAttribute("d", toPath(bent));
    }
    const tick = () => {
      pointer.strength += (pointer.target - pointer.strength) * 0.12;
      if (Math.abs(pointer.target - pointer.strength) < 0.002) {
        pointer.strength = pointer.target;
        bend();
        frame = 0;
        return;
      }
      bend();
      frame = requestAnimationFrame(tick);
    };
    const kick = () => {
      if (!frame) frame = requestAnimationFrame(tick);
    };
    const move = (event: PointerEvent) => {
      if (!drawn) return;
      const box = root.getBoundingClientRect();
      pointer.x = event.clientX - box.left;
      pointer.y = event.clientY - box.top;
      pointer.target = 1;
      if (pointer.strength === 1) bend();
      kick();
    };
    const leave = () => {
      pointer.target = 0;
      kick();
    };
    const interactive = motion && wide && fine;
    if (interactive) {
      hero.addEventListener("pointermove", move);
      hero.addEventListener("pointerleave", leave);
    }

    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
      hero.removeEventListener("pointermove", move);
      hero.removeEventListener("pointerleave", leave);
    };
  });

  return (
    <div ref={wrap} className="hero-line" aria-hidden>
      <svg ref={svgRef} preserveAspectRatio="none">
        <path ref={runRef} className="hero-line-run" />
        <g ref={markRef} className="hero-line-mark">
          <path d={markPath} strokeWidth={7} pathLength={100} />
          <circle cx={52} cy={21} r={5.2} />
        </g>
      </svg>
    </div>
  );
}
