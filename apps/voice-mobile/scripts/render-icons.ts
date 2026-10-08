/**
 * The app icon and splash mark: the PWA's orb (apps/web/public/voice-icon-*)
 * as a radial-gradient blob, drawn at full resolution.
 *
 *   bun scripts/render-icons.ts
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { Resvg } from "@resvg/resvg-js";

const PAPER = "#f9f8f6";

function blob(size: number) {
  const c = size / 2;
  const base = size * 0.34;
  const points: string[] = [];
  for (let index = 0; index <= 96; index++) {
    const angle = (index / 96) * Math.PI * 2;
    const r =
      base *
      (1 +
        Math.sin(angle * 3 + 0.6) * 0.03 +
        Math.sin(angle * 5 - 1.1) * 0.016 +
        Math.sin(angle * 7 + 0.4) * 0.008);
    points.push(
      `${index === 0 ? "M" : "L"}${(c + Math.cos(angle) * r).toFixed(2)} ${(c + Math.sin(angle) * r).toFixed(2)}`,
    );
  }
  return `${points.join(" ")} Z`;
}

function orb(size: number, background: string | null) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <defs>
    <radialGradient id="g" cx="38%" cy="34%" r="70%">
      <stop offset="0" stop-color="#f1f3e0"/>
      <stop offset="0.48" stop-color="#a1bc98"/>
      <stop offset="1" stop-color="#303630"/>
    </radialGradient>
    <filter id="glow" x="-30%" y="-30%" width="160%" height="160%">
      <feGaussianBlur stdDeviation="${size * 0.03}"/>
    </filter>
  </defs>
  ${background ? `<rect width="${size}" height="${size}" fill="${background}"/>` : ""}
  <path d="${blob(size)}" fill="#a1bc98" opacity="0.45" filter="url(#glow)"/>
  <path d="${blob(size)}" fill="url(#g)"/>
</svg>`;
}

function render(svg: string, file: string) {
  writeFileSync(
    join(import.meta.dir, "..", "assets", file),
    new Resvg(svg).render().asPng(),
  );
  console.log(file);
}

render(orb(1024, PAPER), "icon.png");
render(orb(512, null), "splash-icon.png");
