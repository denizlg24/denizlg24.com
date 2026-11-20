const styled = [
  "fill",
  "fill-opacity",
  "stroke",
  "stroke-opacity",
  "stroke-width",
  "stroke-dasharray",
  "opacity",
  "font-size",
  "font-family",
  "font-weight",
  "text-anchor",
  "dominant-baseline",
] as const;

/**
 * Copies an on-screen SVG with every theme variable resolved, so the file
 * looks the same outside the app.
 */
function standalone(svg: SVGSVGElement) {
  const copy = svg.cloneNode(true) as SVGSVGElement;
  const source = [svg, ...svg.querySelectorAll("*")];
  const target = [copy, ...copy.querySelectorAll("*")];
  source.forEach((element, index) => {
    const computed = getComputedStyle(element);
    const node = target[index];
    if (!(node instanceof SVGElement)) return;
    for (const property of styled) {
      const value = computed.getPropertyValue(property);
      if (value) node.style.setProperty(property, value);
    }
  });
  const box = svg.getBoundingClientRect();
  copy.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  copy.setAttribute("width", String(Math.round(box.width)));
  copy.setAttribute("height", String(Math.round(box.height)));
  const background = getComputedStyle(document.body).backgroundColor;
  copy.style.setProperty("background", background);
  return { markup: new XMLSerializer().serializeToString(copy), box, background };
}

function save(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function downloadSvg(svg: SVGSVGElement, filename: string) {
  save(
    new Blob([standalone(svg).markup], { type: "image/svg+xml" }),
    `${filename}.svg`,
  );
}

/** Rasterises one or more stacked SVGs (e.g. chart panes) into a PNG. */
export async function downloadPng(
  svgs: SVGSVGElement[],
  filename: string,
  scale = 2,
) {
  if (!svgs.length) return;
  const parts = svgs.map(standalone);
  const width = Math.max(...parts.map((part) => part.box.width));
  const height = parts.reduce((sum, part) => sum + part.box.height, 0);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  const context = canvas.getContext("2d");
  if (!context) return;
  context.scale(scale, scale);
  context.fillStyle = parts[0].background;
  context.fillRect(0, 0, width, height);
  let offset = 0;
  for (const part of parts) {
    const image = new Image();
    const url = URL.createObjectURL(
      new Blob([part.markup], { type: "image/svg+xml" }),
    );
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("Could not render the image."));
      image.src = url;
    });
    context.drawImage(image, 0, offset, part.box.width, part.box.height);
    URL.revokeObjectURL(url);
    offset += part.box.height;
  }
  await new Promise<void>((resolve) =>
    canvas.toBlob((blob) => {
      if (blob) save(blob, `${filename}.png`);
      resolve();
    }, "image/png"),
  );
}

const cell = (value: unknown) => {
  const text = value == null ? "" : String(value);
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
};

export function downloadCsv(
  rows: Record<string, unknown>[],
  filename: string,
) {
  if (!rows.length) return;
  const columns = Object.keys(rows[0]);
  const body = [
    columns.join(","),
    ...rows.map((row) => columns.map((key) => cell(row[key])).join(",")),
  ].join("\n");
  save(new Blob([body], { type: "text/csv" }), `${filename}.csv`);
}
