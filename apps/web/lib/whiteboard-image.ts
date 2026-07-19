import path from "node:path";
import type { IWhiteboardBackground, IWhiteboardElement } from "@repo/schemas";
import { whiteboardElementKind } from "@repo/schemas";
import { whiteboardToSvg } from "@repo/whiteboard-render";
import { Resvg } from "@resvg/resvg-js";

const MAX_INLINE_IMAGE_BYTES = 3 * 1024 * 1024;
const IMAGE_FETCH_TIMEOUT_MS = 5_000;
const DEFAULT_MAX_DIMENSION = 1400;

const EXCALIFONT_PATH = path.join(
  process.cwd(),
  "assets/fonts/Excalifont-Regular.ttf",
);

async function inlineImageHrefs(
  elements: IWhiteboardElement[],
): Promise<Record<string, string>> {
  const srcs = new Set<string>();
  for (const element of elements) {
    if (whiteboardElementKind(element) !== "image") continue;
    const src = element.data.src;
    if (typeof src === "string" && !src.startsWith("data:")) srcs.add(src);
  }
  const hrefs: Record<string, string> = {};
  await Promise.all(
    [...srcs].map(async (src) => {
      try {
        const res = await fetch(src, {
          signal: AbortSignal.timeout(IMAGE_FETCH_TIMEOUT_MS),
        });
        if (!res.ok) return;
        const bytes = Buffer.from(await res.arrayBuffer());
        if (bytes.length > MAX_INLINE_IMAGE_BYTES) return;
        const mediaType = res.headers.get("content-type") ?? "image/png";
        hrefs[src] = `data:${mediaType};base64,${bytes.toString("base64")}`;
      } catch {
        // unresolved images fall back to the serializer's placeholder
      }
    }),
  );
  return hrefs;
}

export interface WhiteboardPngResult {
  png: Buffer;
  width: number;
  height: number;
}

export async function renderWhiteboardPng(
  elements: IWhiteboardElement[],
  background?: IWhiteboardBackground,
  options?: { maxDimension?: number },
): Promise<WhiteboardPngResult> {
  const imageHrefs = await inlineImageHrefs(elements);
  const { svg } = whiteboardToSvg(elements, {
    background,
    maxDimension: options?.maxDimension ?? DEFAULT_MAX_DIMENSION,
    imageHrefs,
    unresolvedImages: "placeholder",
  });
  const resvg = new Resvg(svg, {
    font: {
      fontFiles: [EXCALIFONT_PATH],
      loadSystemFonts: true,
      defaultFontFamily: "Excalifont",
    },
  });
  const rendered = resvg.render();
  return {
    png: rendered.asPng(),
    width: rendered.width,
    height: rendered.height,
  };
}
