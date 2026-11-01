"use client";

import type { ThemeEffect, ThemeEffectKind } from "@repo/schemas";
import { useEffect, useRef } from "react";

type Particle = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  angle: number;
  spin: number;
  phase: number;
  color: string;
};

type Kind = Exclude<ThemeEffectKind, "none" | "aurora">;

const PALETTES: Record<Kind, string[]> = {
  snow: ["#ffffff", "#f1f6ff", "#e6eefb"],
  leaves: ["#d9893b", "#c0582b", "#e3b23c", "#9c4a1a"],
  petals: ["#f6c1d1", "#f0a8c0", "#fbe3ea"],
  hearts: ["#e5546d", "#f08aa0", "#c43a5a"],
  stars: ["#fff7d6", "#ffffff", "#dfe8ff"],
  confetti: ["#e5546d", "#f2b134", "#4aa3df", "#5cc489", "#9b6bd6"],
  rain: ["#9fb8d0", "#b9cde0"],
  fireflies: ["#f7e98e", "#e4f58a"],
  bubbles: ["#9fd3ea", "#bfe3f2"],
  sparkles: ["#ffe9a8", "#ffffff", "#ffd36b"],
};

/** Falling, rising or still: how each kind moves. */
function spawn(
  kind: Kind,
  width: number,
  height: number,
  color: string | undefined,
  anywhere: boolean,
): Particle {
  const palette = PALETTES[kind];
  const pick = color ?? palette[Math.floor(Math.random() * palette.length)];
  const x = Math.random() * width;
  const rising = kind === "bubbles";
  const still = kind === "stars" || kind === "sparkles" || kind === "fireflies";
  const y =
    anywhere || still ? Math.random() * height : rising ? height + 10 : -10;
  const base = {
    x,
    y,
    angle: Math.random() * Math.PI * 2,
    spin: (Math.random() - 0.5) * 0.04,
    phase: Math.random() * Math.PI * 2,
    color: pick,
  };
  switch (kind) {
    case "snow":
      return {
        ...base,
        vx: 0,
        vy: 0.4 + Math.random() * 0.8,
        size: 1.2 + Math.random() * 2.6,
      };
    case "leaves":
      return {
        ...base,
        vx: 0.3,
        vy: 0.6 + Math.random() * 0.7,
        size: 5 + Math.random() * 5,
      };
    case "petals":
      return {
        ...base,
        vx: 0.4,
        vy: 0.5 + Math.random() * 0.5,
        size: 3 + Math.random() * 3,
      };
    case "hearts":
      return {
        ...base,
        vx: 0,
        vy: 0.5 + Math.random() * 0.6,
        size: 4 + Math.random() * 5,
      };
    case "confetti":
      return {
        ...base,
        vx: (Math.random() - 0.5) * 0.6,
        vy: 1 + Math.random() * 1.2,
        size: 3 + Math.random() * 4,
        spin: (Math.random() - 0.5) * 0.2,
      };
    case "rain":
      return {
        ...base,
        vx: -0.6,
        vy: 7 + Math.random() * 5,
        size: 8 + Math.random() * 10,
      };
    case "bubbles":
      return {
        ...base,
        vx: 0,
        vy: -(0.3 + Math.random() * 0.6),
        size: 3 + Math.random() * 7,
      };
    case "fireflies":
      return {
        ...base,
        vx: (Math.random() - 0.5) * 0.4,
        vy: (Math.random() - 0.5) * 0.4,
        size: 1.5 + Math.random() * 2,
      };
    case "stars":
    case "sparkles":
      return {
        ...base,
        vx: 0,
        vy: 0,
        size: 1 + Math.random() * (kind === "sparkles" ? 4 : 1.6),
      };
  }
}

function drawHeart(ctx: CanvasRenderingContext2D, size: number) {
  ctx.beginPath();
  ctx.moveTo(0, size * 0.3);
  ctx.bezierCurveTo(0, 0, -size, 0, -size, size * 0.3);
  ctx.bezierCurveTo(-size, size * 0.8, 0, size, 0, size * 1.3);
  ctx.bezierCurveTo(0, size, size, size * 0.8, size, size * 0.3);
  ctx.bezierCurveTo(size, 0, 0, 0, 0, size * 0.3);
  ctx.fill();
}

function drawSparkle(ctx: CanvasRenderingContext2D, size: number) {
  ctx.beginPath();
  ctx.moveTo(0, -size);
  ctx.quadraticCurveTo(0, 0, size, 0);
  ctx.quadraticCurveTo(0, 0, 0, size);
  ctx.quadraticCurveTo(0, 0, -size, 0);
  ctx.quadraticCurveTo(0, 0, 0, -size);
  ctx.fill();
}

function draw(
  ctx: CanvasRenderingContext2D,
  kind: Kind,
  p: Particle,
  t: number,
) {
  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.fillStyle = p.color;
  ctx.strokeStyle = p.color;
  switch (kind) {
    case "snow":
    case "fireflies": {
      if (kind === "fireflies") {
        ctx.globalAlpha = 0.35 + 0.65 * Math.abs(Math.sin(t / 900 + p.phase));
        ctx.shadowColor = p.color;
        ctx.shadowBlur = 8;
      } else {
        ctx.globalAlpha = 0.85;
      }
      ctx.beginPath();
      ctx.arc(0, 0, p.size, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case "leaves":
    case "petals": {
      ctx.rotate(p.angle);
      ctx.globalAlpha = 0.8;
      ctx.beginPath();
      ctx.ellipse(
        0,
        0,
        p.size,
        p.size * (kind === "leaves" ? 0.45 : 0.6),
        0,
        0,
        Math.PI * 2,
      );
      ctx.fill();
      break;
    }
    case "hearts": {
      ctx.rotate(Math.sin(t / 700 + p.phase) * 0.3);
      ctx.globalAlpha = 0.7;
      drawHeart(ctx, p.size);
      break;
    }
    case "confetti": {
      ctx.rotate(p.angle);
      ctx.globalAlpha = 0.9;
      ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
      break;
    }
    case "rain": {
      ctx.globalAlpha = 0.45;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(p.vx * 2, p.size);
      ctx.stroke();
      break;
    }
    case "bubbles": {
      ctx.globalAlpha = 0.6;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(0, 0, p.size, 0, Math.PI * 2);
      ctx.stroke();
      break;
    }
    case "stars": {
      ctx.globalAlpha = 0.3 + 0.7 * Math.abs(Math.sin(t / 1400 + p.phase));
      ctx.beginPath();
      ctx.arc(0, 0, p.size, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case "sparkles": {
      const pulse = Math.abs(Math.sin(t / 1100 + p.phase));
      ctx.globalAlpha = pulse;
      drawSparkle(ctx, p.size * (0.5 + pulse * 0.5));
      break;
    }
  }
  ctx.restore();
}

function step(kind: Kind, p: Particle, t: number) {
  p.angle += p.spin;
  switch (kind) {
    case "snow":
    case "petals":
    case "hearts":
      p.x += Math.sin(t / 1200 + p.phase) * 0.4 + p.vx;
      p.y += p.vy;
      break;
    case "leaves":
      p.x += Math.sin(t / 900 + p.phase) * 0.9 + p.vx;
      p.y += p.vy;
      break;
    case "fireflies":
      p.vx += (Math.random() - 0.5) * 0.04;
      p.vy += (Math.random() - 0.5) * 0.04;
      p.vx = Math.max(-0.5, Math.min(0.5, p.vx));
      p.vy = Math.max(-0.5, Math.min(0.5, p.vy));
      p.x += p.vx;
      p.y += p.vy;
      break;
    case "bubbles":
      p.x += Math.sin(t / 800 + p.phase) * 0.3;
      p.y += p.vy;
      break;
    default:
      p.x += p.vx;
      p.y += p.vy;
  }
}

function outside(kind: Kind, p: Particle, width: number, height: number) {
  if (kind === "fireflies") {
    return p.x < -20 || p.x > width + 20 || p.y < -20 || p.y > height + 20;
  }
  if (kind === "bubbles") return p.y < -20;
  if (kind === "stars" || kind === "sparkles") return false;
  return p.y > height + 20 || p.x < -40 || p.x > width + 40;
}

const AURORA_KEYFRAMES = `
@keyframes theme-aurora-a { 0%,100% { transform: translate(-10%, -10%) scale(1); } 50% { transform: translate(15%, 10%) scale(1.25); } }
@keyframes theme-aurora-b { 0%,100% { transform: translate(10%, 5%) scale(1.1); } 50% { transform: translate(-15%, -10%) scale(0.9); } }
@keyframes theme-aurora-c { 0%,100% { transform: translate(0, 10%) scale(0.9); } 50% { transform: translate(10%, -15%) scale(1.2); } }
@media (prefers-reduced-motion: reduce) { .theme-aurora > div { animation: none !important; } }
`;

/** Three slow, blurred blobs in the theme's colours, blended over the app. */
function Aurora({ effect, dark }: { effect: ThemeEffect; dark: boolean }) {
  const colors = effect.color
    ? [effect.color, effect.color, effect.color]
    : ["var(--accent)", "var(--chart-2)", "var(--chart-4)"];
  const blob = (color: string, animation: string, at: string) => ({
    position: "absolute" as const,
    width: "60vmax",
    height: "60vmax",
    left: at.split(" ")[0],
    top: at.split(" ")[1],
    borderRadius: "50%",
    background: `radial-gradient(circle, ${color} 0%, transparent 65%)`,
    filter: "blur(40px)",
    animation: `${animation} ${28 + effect.density * -10}s ease-in-out infinite`,
  });
  return (
    <div
      aria-hidden
      className="theme-aurora pointer-events-none fixed inset-0 z-40 overflow-hidden"
      style={{
        opacity: 0.12 + effect.density * 0.25,
        mixBlendMode: dark ? "screen" : "multiply",
      }}
    >
      <style>{AURORA_KEYFRAMES}</style>
      <div
        style={blob(
          colors[0] ?? "var(--accent)",
          "theme-aurora-a",
          "-10% -20%",
        )}
      />
      <div
        style={blob(colors[1] ?? "var(--accent)", "theme-aurora-b", "50% 30%")}
      />
      <div
        style={blob(colors[2] ?? "var(--accent)", "theme-aurora-c", "10% 60%")}
      />
    </div>
  );
}

/** The theme's ambient effect: particles on a canvas, or the aurora layer. */
export function EffectLayer({
  effect,
  dark = false,
}: {
  effect: ThemeEffect;
  dark?: boolean;
}) {
  if (effect.kind === "aurora") return <Aurora effect={effect} dark={dark} />;
  return <ParticleLayer effect={effect} />;
}

function ParticleLayer({ effect }: { effect: ThemeEffect }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { kind, density, color } = effect;

  useEffect(() => {
    if (kind === "none" || kind === "aurora") return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    let width = 0;
    let height = 0;
    const resize = () => {
      const ratio = window.devicePixelRatio || 1;
      width = window.innerWidth;
      height = window.innerHeight;
      canvas.width = width * ratio;
      canvas.height = height * ratio;
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    };
    resize();
    window.addEventListener("resize", resize);

    const still = kind === "stars" || kind === "sparkles";
    const count = Math.round((still ? 20 : 10) + density * (still ? 80 : 110));
    const particles = Array.from({ length: count }, () =>
      spawn(kind, width, height, color, true),
    );

    let frame = 0;
    const tick = (t: number) => {
      ctx.clearRect(0, 0, width, height);
      for (let i = 0; i < particles.length; i++) {
        const p = particles[i];
        step(kind, p, t);
        if (outside(kind, p, width, height)) {
          particles[i] = spawn(kind, width, height, color, false);
          continue;
        }
        draw(ctx, kind, p, t);
      }
      frame = requestAnimationFrame(tick);
    };
    const onVisibility = () => {
      cancelAnimationFrame(frame);
      if (!document.hidden) frame = requestAnimationFrame(tick);
    };
    document.addEventListener("visibilitychange", onVisibility);
    frame = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", resize);
      document.removeEventListener("visibilitychange", onVisibility);
      ctx.clearRect(0, 0, width, height);
    };
  }, [kind, density, color]);

  if (kind === "none" || kind === "aurora") return null;
  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      className="pointer-events-none fixed inset-0 z-40 h-screen w-screen"
    />
  );
}
