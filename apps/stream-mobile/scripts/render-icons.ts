/**
 * The app icon, Android's adaptive foreground, the splash mark (a play
 * triangle on ink) and the film grain laid over full-bleed imagery.
 *
 *   bun scripts/render-icons.ts
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { Resvg } from "@resvg/resvg-js";

const NIGHT = "#0c0b0a";
const GLOW = "#2a1d14";
const EMBER = "#f2b54a";

/** `scale` shrinks the glyph for Android's adaptive mask, which crops the outer third. */
function mark(size: number, background: boolean, scale = 1) {
  const s = (size / 512) * scale;
  const offset = (size - 512 * s) / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <defs>
    <radialGradient id="glow" cx="50%" cy="42%" r="62%">
      <stop offset="0" stop-color="${GLOW}"/>
      <stop offset="1" stop-color="${NIGHT}"/>
    </radialGradient>
  </defs>
  ${background ? `<rect width="${size}" height="${size}" fill="url(#glow)"/>` : ""}
  <g transform="translate(${offset} ${offset}) scale(${s})">
    <path d="M196 148 L376 256 L196 364 Z" fill="${EMBER}" stroke="${EMBER}" stroke-width="28" stroke-linejoin="round"/>
  </g>
</svg>`;
}

function render(svg: string, file: string) {
  const png = new Resvg(svg).render().asPng();
  writeFileSync(join(import.meta.dir, "..", "assets", file), png);
  console.log(file);
}

render(mark(1024, true), "icon.png");
render(mark(1024, false, 0.72), "android-icon-foreground.png");
render(mark(512, false), "splash-icon.png");

/** Monochrome noise; drawn at 7 % opacity it reads as grain, not texture. */
const GRAIN = `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="320">
  <filter id="n"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" stitchTiles="stitch"/><feColorMatrix type="saturate" values="0"/></filter>
  <rect width="320" height="320" filter="url(#n)"/>
</svg>`;
render(GRAIN, "grain.png");
