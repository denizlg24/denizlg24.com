/**
 * The app icon and splash mark, drawn here so they stay sharp at 1024 px:
 * four panes in the house ink on the paper background.
 *
 *   bun scripts/render-icons.ts
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { Resvg } from "@resvg/resvg-js";

const INK = "#1c1c1e";
const PAPER = "#f9f8f6";

function panes(size: number, background: string | null) {
  const s = size / 512;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  ${background ? `<rect width="${size}" height="${size}" fill="${background}"/>` : ""}
  <g fill="none" stroke="${INK}" stroke-width="22" stroke-linejoin="round" transform="scale(${s})">
    <rect x="120" y="120" width="120" height="160" rx="22"/>
    <rect x="272" y="120" width="120" height="96" rx="22"/>
    <rect x="120" y="312" width="120" height="80" rx="22"/>
    <rect x="272" y="248" width="120" height="144" rx="22"/>
  </g>
</svg>`;
}

function render(svg: string, file: string) {
  const png = new Resvg(svg).render().asPng();
  writeFileSync(join(import.meta.dir, "..", "assets", file), png);
  console.log(file);
}

render(panes(1024, PAPER), "icon.png");
render(panes(512, null), "splash-icon.png");
