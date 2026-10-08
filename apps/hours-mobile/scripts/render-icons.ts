/**
 * The app icon and splash mark, drawn here so they stay sharp at 1024 px:
 * the PWA's clock (apps/web/public/hours-icon-*.png) on its paper background.
 *
 *   bun scripts/render-icons.ts
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { Resvg } from "@resvg/resvg-js";

const INK = "#1f4d36";
const PAPER = "#f9f8f6";

function clock(size: number, background: string | null) {
  const s = size / 512;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  ${background ? `<rect width="${size}" height="${size}" fill="${background}"/>` : ""}
  <g fill="none" stroke="${INK}" stroke-linecap="round" stroke-linejoin="round" transform="scale(${s})">
    <circle cx="256" cy="256" r="148" stroke-width="22"/>
    <path d="M256 178 V256 L344 205" stroke-width="22"/>
  </g>
  <circle cx="${256 * s}" cy="${256 * s}" r="${15 * s}" fill="${INK}"/>
</svg>`;
}

function render(svg: string, file: string) {
  const png = new Resvg(svg).render().asPng();
  writeFileSync(join(import.meta.dir, "..", "assets", file), png);
  console.log(file);
}

render(clock(1024, PAPER), "icon.png");
render(clock(512, null), "splash-icon.png");
