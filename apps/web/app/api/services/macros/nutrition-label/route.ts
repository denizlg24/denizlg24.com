import { timingSafeEqual } from "node:crypto";
import {
  type MacrosVisionLabelResponse,
  macrosVisionLabelFormatSchema,
} from "@repo/schemas/macros";
import { NextResponse } from "next/server";
import { generateStructured } from "@/lib/llm-service";
import {
  DEFAULT_NUTRITION_LABEL_MODEL,
  NUTRITION_LABEL_SYSTEM,
  nutritionLabelPrompt,
  nutritionLabelReadingSchema,
  toLabelResponse,
} from "@/lib/macros-nutrition-label";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
]);
const TIMEOUT_MS = 15_000;

// Macros' server is the only caller. It holds a secret good for this route
// alone rather than an admin token: Macros is the one multi-user app, and
// every token this site accepts is a superuser one.
function isMacrosRequest(request: Request): boolean {
  const token = process.env.MACROS_LABEL_SERVICE_TOKEN?.trim();
  const provided = request.headers.get("authorization");
  if (!token || !provided) return false;
  const expected = Buffer.from(`Bearer ${token}`);
  const actual = Buffer.from(provided);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export async function POST(request: Request) {
  if (!isMacrosRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const form = await request.formData();
  const image = form.get("image");
  if (!(image instanceof Blob)) {
    return NextResponse.json({ error: "Image is required" }, { status: 400 });
  }
  if (!IMAGE_TYPES.has(image.type)) {
    return NextResponse.json(
      { error: "Unsupported image type" },
      { status: 415 },
    );
  }
  if (image.size > MAX_IMAGE_BYTES) {
    return NextResponse.json({ error: "Image is too large" }, { status: 413 });
  }
  const format = macrosVisionLabelFormatSchema.safeParse(
    form.get("labelFormat"),
  );

  try {
    const { output } = await generateStructured({
      purpose: "nutrition-label",
      source: "macros-nutrition-label",
      model: process.env.MACROS_LABEL_MODEL || DEFAULT_NUTRITION_LABEL_MODEL,
      system: NUTRITION_LABEL_SYSTEM,
      prompt: nutritionLabelPrompt(format.success ? format.data : undefined),
      images: [
        {
          data: new Uint8Array(await image.arrayBuffer()),
          mediaType: image.type,
        },
      ],
      schema: nutritionLabelReadingSchema,
      fast: true,
      timeoutMs: TIMEOUT_MS,
      signal: request.signal,
    });
    return NextResponse.json(
      toLabelResponse(output) satisfies MacrosVisionLabelResponse,
    );
  } catch (error) {
    console.error("[macros-nutrition-label] read failed:", error);
    return NextResponse.json(
      { error: "The label could not be read" },
      { status: 502 },
    );
  }
}
