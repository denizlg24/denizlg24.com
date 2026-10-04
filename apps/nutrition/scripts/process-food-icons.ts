import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";

import sharp from "sharp";

interface Rectangle {
  left: number;
  top: number;
  width: number;
  height: number;
}

interface Grid {
  columns: number;
  rows: number;
  paddingLeft?: number;
  paddingTop?: number;
  paddingRight?: number;
  paddingBottom?: number;
  gapX?: number;
  gapY?: number;
}

interface GridCell {
  row: number;
  column: number;
}

interface BorderCleanup extends GridCell {
  left: number;
  top: number;
  right: number;
  bottom: number;
  thickness: number;
}

interface Sheet {
  id: string;
  input: string;
  foodGroup: string;
  crop: Rectangle;
  grid: Grid;
  skipCells?: GridCell[];
  eraseBorders?: BorderCleanup[];
  eraseTopPixels?: number;
}

interface SheetManifest {
  outputDirectory: string;
  backgroundTolerance?: number;
  backgroundMode?: "corner-color" | "dark-neutral";
  backgroundMaxChannel?: number;
  backgroundMaxChroma?: number;
  iconCanvasSize?: number;
  iconPadding?: number;
  sheets: Sheet[];
}

interface IconManifestEntry {
  key: string;
  foodGroup: string;
  file: string;
  sourceSheet: string;
  row: number;
  column: number;
}

const commands = ["crop", "remove-background", "split", "all"] as const;
type Command = (typeof commands)[number];

const command = Bun.argv.find((argument): argument is Command =>
  commands.includes(argument as Command),
);

if (!command) {
  throw new Error(
    "Usage: bun run icons:process -- crop|remove-background|split|all [--manifest path] [--use-cropped]",
  );
}

const readOption = (name: string, fallback: string) => {
  const index = Bun.argv.indexOf(name);
  return index === -1 ? fallback : (Bun.argv[index + 1] ?? fallback);
};

const manifestPath = resolve(
  readOption("--manifest", "config/food-icons/sheets.json"),
);
const manifestDirectory = dirname(manifestPath);
const manifest = JSON.parse(
  await readFile(manifestPath, "utf8"),
) as SheetManifest;
const outputDirectory = resolve(manifestDirectory, manifest.outputDirectory);

const slug = (value: string) =>
  value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

const validatePositiveInteger = (value: number, label: string) => {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${label} must be a positive integer`);
  }
};

for (const sheet of manifest.sheets) {
  if (!sheet.id || !sheet.foodGroup || !sheet.input) {
    throw new Error("Every sheet requires id, foodGroup, and input");
  }

  for (const field of ["left", "top", "width", "height"] as const) {
    const value = sheet.crop[field];
    if (
      !Number.isInteger(value) ||
      value < (field === "width" || field === "height" ? 1 : 0)
    ) {
      throw new Error(`${sheet.id}.crop.${field} is invalid`);
    }
  }

  validatePositiveInteger(sheet.grid.columns, `${sheet.id}.grid.columns`);
  validatePositiveInteger(sheet.grid.rows, `${sheet.id}.grid.rows`);
}

const pathFor = (stage: "grids" | "background-removed", sheet: Sheet) =>
  resolve(outputDirectory, stage, `${sheet.id}.png`);

const cropSheets = async () => {
  await mkdir(resolve(outputDirectory, "grids"), { recursive: true });

  for (const sheet of manifest.sheets) {
    const inputPath = resolve(manifestDirectory, sheet.input);
    const outputPath = pathFor("grids", sheet);
    await sharp(inputPath).extract(sheet.crop).png().toFile(outputPath);
    console.log(`Cropped ${sheet.id} -> ${outputPath}`);
  }
};

const median = (values: number[]) => {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
};

const removeConnectedBackground = async (
  inputPath: string,
  outputPath: string,
) => {
  const { data, info } = await sharp(inputPath)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;
  const cornerPixels = [0, width - 1, (height - 1) * width, height * width - 1];
  const background = [0, 1, 2].map((channel) =>
    median(cornerPixels.map((pixel) => data[pixel * channels + channel] ?? 0)),
  );
  const tolerance = manifest.backgroundTolerance ?? 24;
  const toleranceSquared = tolerance * tolerance;
  const visited = new Uint8Array(width * height);
  const queue = new Int32Array(width * height);
  let head = 0;
  let tail = 0;

  const isBackground = (pixel: number) => {
    const offset = pixel * channels;
    const values = [
      data[offset] ?? 0,
      data[offset + 1] ?? 0,
      data[offset + 2] ?? 0,
    ];

    if (manifest.backgroundMode === "dark-neutral") {
      return (
        Math.max(...values) <= (manifest.backgroundMaxChannel ?? 48) &&
        Math.max(...values) - Math.min(...values) <=
          (manifest.backgroundMaxChroma ?? 6)
      );
    }

    const red = (values[0] ?? 0) - (background[0] ?? 0);
    const green = (values[1] ?? 0) - (background[1] ?? 0);
    const blue = (values[2] ?? 0) - (background[2] ?? 0);
    return red * red + green * green + blue * blue <= toleranceSquared;
  };

  const enqueue = (pixel: number) => {
    if (visited[pixel] || !isBackground(pixel)) return;
    visited[pixel] = 1;
    queue[tail++] = pixel;
  };

  for (let x = 0; x < width; x += 1) {
    enqueue(x);
    enqueue((height - 1) * width + x);
  }
  for (let y = 0; y < height; y += 1) {
    enqueue(y * width);
    enqueue(y * width + width - 1);
  }

  while (head < tail) {
    const pixel = queue[head++] ?? 0;
    const x = pixel % width;
    const y = Math.floor(pixel / width);
    if (x > 0) enqueue(pixel - 1);
    if (x + 1 < width) enqueue(pixel + 1);
    if (y > 0) enqueue(pixel - width);
    if (y + 1 < height) enqueue(pixel + width);
  }

  for (let pixel = 0; pixel < visited.length; pixel += 1) {
    if (visited[pixel]) {
      const offset = pixel * channels;
      data[offset] = 0;
      data[offset + 1] = 0;
      data[offset + 2] = 0;
      data[offset + 3] = 0;
    }
  }

  await mkdir(dirname(outputPath), { recursive: true });
  await sharp(data, { raw: info }).png().toFile(outputPath);
};

const eraseBorder = async (input: Buffer, cleanup: BorderCleanup) => {
  const { data, info } = await sharp(input)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  for (let y = cleanup.top; y <= cleanup.bottom; y += 1) {
    for (let x = cleanup.left; x <= cleanup.right; x += 1) {
      const isRing =
        x < cleanup.left + cleanup.thickness ||
        x > cleanup.right - cleanup.thickness ||
        y < cleanup.top + cleanup.thickness ||
        y > cleanup.bottom - cleanup.thickness;

      if (isRing && x >= 0 && y >= 0 && x < info.width && y < info.height) {
        const offset = (y * info.width + x) * info.channels;
        data[offset] = 0;
        data[offset + 1] = 0;
        data[offset + 2] = 0;
        data[offset + 3] = 0;
      }
    }
  }

  for (let pixel = 0; pixel < info.width * info.height; pixel += 1) {
    const offset = pixel * info.channels;
    const values = [
      data[offset] ?? 0,
      data[offset + 1] ?? 0,
      data[offset + 2] ?? 0,
    ];

    if (
      Math.max(...values) <= (manifest.backgroundMaxChannel ?? 48) &&
      Math.max(...values) - Math.min(...values) <=
        (manifest.backgroundMaxChroma ?? 6)
    ) {
      data[offset + 3] = 0;
    }
  }

  return sharp(data, { raw: info }).png().toBuffer();
};

const eraseTop = async (input: Buffer, height: number) => {
  const { data, info } = await sharp(input)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const erasedHeight = Math.min(height, info.height);

  for (let y = 0; y < erasedHeight; y += 1) {
    for (let x = 0; x < info.width; x += 1) {
      const offset = (y * info.width + x) * info.channels;
      data[offset] = 0;
      data[offset + 1] = 0;
      data[offset + 2] = 0;
      data[offset + 3] = 0;
    }
  }

  return sharp(data, { raw: info }).png().toBuffer();
};

const normalizeIcon = async (input: Buffer) => {
  const canvasSize = manifest.iconCanvasSize;
  if (!canvasSize) return input;

  const padding = manifest.iconPadding ?? 0;
  const usableSize = canvasSize - padding * 2;

  if (usableSize < 1) {
    throw new Error("iconPadding leaves no usable icon canvas");
  }

  // Materialize the trim before reading dimensions. Sharp's metadata() reports
  // the input dimensions even when a trim operation is queued, which made us
  // treat every grid cell as square and stretch non-square icons into squares.
  const { data: trimmed, info } = await sharp(input)
    .trim({
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png()
    .toBuffer({ resolveWithObject: true });
  const width = info.width;
  const height = info.height;
  const scale = Math.min(1, usableSize / width, usableSize / height);
  const outputWidth = Math.round(width * scale);
  const outputHeight = Math.round(height * scale);
  let pipeline = sharp(trimmed);

  if (scale < 1) {
    pipeline = pipeline.resize({
      width: outputWidth,
      height: outputHeight,
    });
  }

  return pipeline
    .extend({
      top: Math.floor((canvasSize - outputHeight) / 2),
      bottom: Math.ceil((canvasSize - outputHeight) / 2),
      left: Math.floor((canvasSize - outputWidth) / 2),
      right: Math.ceil((canvasSize - outputWidth) / 2),
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png()
    .toBuffer();
};

const removeBackgrounds = async () => {
  for (const sheet of manifest.sheets) {
    const inputPath = pathFor("grids", sheet);
    const outputPath = pathFor("background-removed", sheet);
    await removeConnectedBackground(inputPath, outputPath);
    console.log(`Removed connected background from ${sheet.id}`);
  }
};

const fileExists = async (path: string) =>
  access(path).then(
    () => true,
    () => false,
  );

const splitSheets = async () => {
  const iconsDirectory = resolve(outputDirectory, "icons");
  await mkdir(iconsDirectory, { recursive: true });
  const counters = new Map<string, number>();
  const icons: IconManifestEntry[] = [];

  for (const sheet of manifest.sheets) {
    const backgroundRemovedPath = pathFor("background-removed", sheet);
    const useCropped = Bun.argv.includes("--use-cropped");
    const inputPath = (await fileExists(backgroundRemovedPath))
      ? backgroundRemovedPath
      : useCropped
        ? pathFor("grids", sheet)
        : undefined;

    if (!inputPath) {
      throw new Error(
        `Missing background-removed grid for ${sheet.id}. Run remove-background, provide it manually, or pass --use-cropped.`,
      );
    }

    const metadata = await sharp(inputPath).metadata();
    const width = metadata.width ?? sheet.crop.width;
    const height = metadata.height ?? sheet.crop.height;
    const grid = sheet.grid;
    const paddingLeft = grid.paddingLeft ?? 0;
    const paddingTop = grid.paddingTop ?? 0;
    const paddingRight = grid.paddingRight ?? 0;
    const paddingBottom = grid.paddingBottom ?? 0;
    const gapX = grid.gapX ?? 0;
    const gapY = grid.gapY ?? 0;
    const availableWidth =
      width - paddingLeft - paddingRight - gapX * (grid.columns - 1);
    const availableHeight =
      height - paddingTop - paddingBottom - gapY * (grid.rows - 1);

    if (availableWidth < grid.columns || availableHeight < grid.rows) {
      throw new Error(`Grid dimensions do not fit inside ${sheet.id}`);
    }

    const cellWidth = availableWidth / grid.columns;
    const cellHeight = availableHeight / grid.rows;
    const skipped = new Set(
      (sheet.skipCells ?? []).map((cell) => `${cell.row}:${cell.column}`),
    );
    const groupSlug = slug(sheet.foodGroup);

    for (let row = 1; row <= grid.rows; row += 1) {
      for (let column = 1; column <= grid.columns; column += 1) {
        if (skipped.has(`${row}:${column}`)) continue;

        const left = Math.round(
          paddingLeft + (column - 1) * (cellWidth + gapX),
        );
        const top = Math.round(paddingTop + (row - 1) * (cellHeight + gapY));
        const right = Math.round(
          paddingLeft + column * cellWidth + (column - 1) * gapX,
        );
        const bottom = Math.round(
          paddingTop + row * cellHeight + (row - 1) * gapY,
        );
        const index = (counters.get(groupSlug) ?? 0) + 1;
        counters.set(groupSlug, index);
        const key = `${groupSlug}-${String(index).padStart(3, "0")}`;
        const outputPath = resolve(iconsDirectory, `${key}.png`);

        let iconBuffer = await sharp(inputPath)
          .extract({
            left,
            top,
            width: right - left,
            height: bottom - top,
          })
          .png()
          .toBuffer();

        if (row === 1 && sheet.eraseTopPixels) {
          iconBuffer = await eraseTop(iconBuffer, sheet.eraseTopPixels);
        }
        const cleanup = sheet.eraseBorders?.find(
          (entry) => entry.row === row && entry.column === column,
        );

        if (cleanup) iconBuffer = await eraseBorder(iconBuffer, cleanup);
        iconBuffer = await normalizeIcon(iconBuffer);
        await writeFile(outputPath, iconBuffer);

        icons.push({
          key,
          foodGroup: sheet.foodGroup,
          file: relative(outputDirectory, outputPath),
          sourceSheet: sheet.id,
          row,
          column,
        });
      }
    }
  }

  await writeFile(
    resolve(outputDirectory, "icons.json"),
    `${JSON.stringify({ icons }, null, 2)}\n`,
  );
  console.log(`Split ${icons.length} icons -> ${iconsDirectory}`);
};

if (command === "crop" || command === "all") await cropSheets();
if (command === "remove-background" || command === "all") {
  await removeBackgrounds();
}
if (command === "split" || command === "all") await splitSheets();
