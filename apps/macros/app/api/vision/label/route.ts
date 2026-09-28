import {
  type MacrosVisionLabelResponse,
  macrosVisionLabelFormatSchema,
} from "@repo/schemas/macros";
import { NextResponse } from "next/server";
import { getRequiredSession } from "@/lib/api/session";
import { parseNutritionLabel, VisionServiceError } from "@/lib/vision-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const { session, response } = await getRequiredSession();
  if (!session) return response;
  const form = await request.formData();
  const image = form.get("image");
  const requestedFormat = form.get("labelFormat");
  const parsedFormat = macrosVisionLabelFormatSchema.safeParse(requestedFormat);
  const labelFormat = parsedFormat.success ? parsedFormat.data : undefined;
  if (!(image instanceof Blob)) {
    return NextResponse.json({ error: "Image is required" }, { status: 400 });
  }
  try {
    return NextResponse.json(
      (await parseNutritionLabel(
        image,
        labelFormat,
      )) satisfies MacrosVisionLabelResponse,
    );
  } catch (error) {
    if (error instanceof VisionServiceError) {
      return NextResponse.json(
        { error: "Label scanning is unavailable; enter the values manually." },
        { status: error.status && error.status < 500 ? error.status : 503 },
      );
    }
    throw error;
  }
}
