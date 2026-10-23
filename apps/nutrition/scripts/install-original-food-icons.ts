import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import sharp from "sharp";

interface OriginalIcon {
  key: string;
  foodGroup: string;
  subject: string;
  prompt: string;
  existing: boolean;
  replacesSha256?: string;
  patterns?: string[];
}

const project = resolve(import.meta.dir, "..");
const assets = resolve(project, "assets/food-icons");
const publicRoot = resolve(project, "../macros/public/food-icons");
const plan = JSON.parse(
  await readFile(resolve(project, "config/food-icons/originals.json"), "utf8"),
) as { version: string; generator: string; icons: OriginalIcon[] };

// Validate and prepare the ENTIRE set before replacing any live asset. An
// interrupted generation must never publish a partially replaced catalogue.
const prepared: Array<{ icon: OriginalIcon; png: Buffer }> = [];
for (const icon of plan.icons) {
  const source = await readFile(
    resolve(assets, "originals", `${icon.key}.png`),
  );
  if (
    createHash("sha256").update(source).digest("hex") === icon.replacesSha256
  ) {
    throw new Error(`${icon.key}: source is still the legacy artwork`);
  }
  const image = sharp(source);
  if (
    !(await image.metadata()).hasAlpha ||
    (await image.stats()).channels[3]?.min !== 0
  ) {
    throw new Error(`${icon.key}: source has no transparent background`);
  }
  const cropped = await image
    .trim({ threshold: 8 })
    .resize(95, 95, { fit: "inside" })
    .png()
    .toBuffer();
  const png = await sharp(cropped)
    .resize(128, 128, {
      fit: "contain",
      withoutEnlargement: true,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png()
    .toBuffer();
  prepared.push({ icon, png });
}

const rulesPath = resolve(project, "config/food-icons/rules.json");
const captionsPath = resolve(project, "config/food-icons/captions.json");
const rules = JSON.parse(await readFile(rulesPath, "utf8")) as {
  defaultIconKey: string;
  rules: Array<{ iconKey: string; priority: number; patterns: string[] }>;
};
const captions = JSON.parse(await readFile(captionsPath, "utf8")) as Record<
  string,
  string
>;
const additions = plan.icons.filter((icon) => !icon.existing);
const additionKeys = new Set(additions.map((icon) => icon.key));
rules.rules = [
  ...additions.map((icon) => ({
    iconKey: icon.key,
    priority: 490,
    patterns: icon.patterns ?? [],
  })),
  ...rules.rules.filter((rule) => !additionKeys.has(rule.iconKey)),
];
for (const icon of plan.icons) captions[icon.key] = icon.subject;

await mkdir(publicRoot, { recursive: true });
for (const { icon, png } of prepared) {
  await writeFile(resolve(assets, "icons", `${icon.key}.png`), png);
  await writeFile(resolve(publicRoot, `${icon.key}.png`), png);
}

const manifest = {
  version: plan.version,
  generator: plan.generator,
  icons: plan.icons.map((icon) => ({
    key: icon.key,
    foodGroup: icon.foodGroup,
    file: `icons/${icon.key}.png`,
    label: icon.subject,
  })),
};
const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;
await writeFile(resolve(assets, "icons.json"), json(manifest));
await writeFile(resolve(publicRoot, "catalog.json"), json(manifest));
await writeFile(rulesPath, json(rules));
await writeFile(captionsPath, json(captions));

// Remove the copied source sheets too, so they cannot be redistributed or
// accidentally used to regenerate the old icon set.
for (const directory of ["grids", "background-removed"]) {
  await rm(resolve(assets, directory), { recursive: true, force: true });
}
await rm(resolve(project, "config/food-icons/sheets.json"), { force: true });
console.log(
  `Installed ${prepared.length} original icons (${additions.length} additions)`,
);
