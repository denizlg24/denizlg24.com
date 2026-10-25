/**
 * The app icon, Android's adaptive foreground, the splash mark (a play
 * triangle on ink), the Google TV launcher banner and the film grain laid
 * over full-bleed imagery.
 *
 *   bun scripts/render-icons.ts
 */
import { mkdirSync, writeFileSync } from "node:fs";
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

const DISPLAY_FONT = Bun.resolveSync(
  "@expo-google-fonts/big-shoulders/900Black/BigShoulders_900Black.ttf",
  import.meta.dir,
);

function render(svg: string, file: string) {
  const png = new Resvg(svg, {
    font: { fontFiles: [DISPLAY_FONT], loadSystemFonts: false },
  })
    .render()
    .asPng();
  writeFileSync(join(import.meta.dir, "..", "assets", file), png);
  console.log(file);
}

render(mark(1024, true), "icon.png");
render(mark(1024, false, 0.72), "android-icon-foreground.png");
render(mark(512, false), "splash-icon.png");

/** Google TV's launcher tile: the wordmark on the icon's glow, 320 × 180 xhdpi. */
const BANNER = `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180" viewBox="0 0 320 180">
  <defs>
    <radialGradient id="glow" cx="50%" cy="45%" r="70%">
      <stop offset="0" stop-color="${GLOW}"/>
      <stop offset="1" stop-color="${NIGHT}"/>
    </radialGradient>
  </defs>
  <rect width="320" height="180" fill="url(#glow)"/>
  <path d="M44 70 L80 90 L44 110 Z" fill="${EMBER}" stroke="${EMBER}" stroke-width="8" stroke-linejoin="round"/>
  <text x="94" y="112" font-family="Big Shoulders" font-weight="900" font-size="58" fill="#efe9df">STREAM</text>
</svg>`;
render(BANNER, "tv-banner.png");

/** Monochrome noise; drawn at 7 % opacity it reads as grain, not texture. */
const GRAIN = `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="320">
  <filter id="n"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" stitchTiles="stitch"/><feColorMatrix type="saturate" values="0"/></filter>
  <rect width="320" height="320" filter="url(#n)"/>
</svg>`;
render(GRAIN, "grain.png");

const web = join(import.meta.dir, "../../stream");
mkdirSync(join(web, "public"), { recursive: true });
for (const [file, size] of [
  ["icon.png", 512],
  ["apple-icon.png", 180],
] as const) {
  writeFileSync(
    join(web, "app", file),
    new Resvg(mark(size, true)).render().asPng(),
  );
}
writeFileSync(
  join(web, "public", "icon-192.png"),
  new Resvg(mark(192, true)).render().asPng(),
);
writeFileSync(
  join(web, "app", "opengraph-image.png"),
  new Resvg(
    `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630"><rect width="1200" height="630" fill="${NIGHT}"/><path d="M120 210 L300 315 L120 420 Z" fill="${EMBER}"/><text x="380" y="335" font-family="sans-serif" font-size="100" font-weight="bold" fill="#efe9df">Stream</text><text x="385" y="410" font-family="sans-serif" font-size="28" fill="#efe9df">Films and series for the family</text></svg>`,
  )
    .render()
    .asPng(),
);
