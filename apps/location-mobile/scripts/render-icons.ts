/**
 * The app icon and splash mark: a location arrow on the paper background the
 * other personal apps use.
 *
 *   bun scripts/render-icons.ts
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { Resvg } from "@resvg/resvg-js";

const INK = "#1f3a4d";
const PAPER = "#f9f8f6";

function arrow(size: number, background: string | null) {
  const s = size / 512;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  ${background ? `<rect width="${size}" height="${size}" fill="${background}"/>` : ""}
  <g transform="scale(${s})">
    <path d="M256 112 L364 392 L256 336 L148 392 Z" fill="${INK}" stroke="${INK}" stroke-width="14" stroke-linejoin="round"/>
  </g>
</svg>`;
}

function render(svg: string, file: string) {
  const png = new Resvg(svg).render().asPng();
  writeFileSync(join(import.meta.dir, "..", "assets", file), png);
  console.log(file);
}

render(arrow(1024, PAPER), "icon.png");
render(arrow(512, null), "splash-icon.png");
