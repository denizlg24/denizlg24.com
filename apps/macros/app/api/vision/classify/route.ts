import { NextResponse } from "next/server";
import { getRequiredSession } from "@/lib/api/session";
import { classifyFoodPhoto, VisionServiceError } from "@/lib/vision-client";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const { session, response } = await getRequiredSession();
  if (!session) return response;
  const form = await request.formData();
  const image = form.get("image");
  if (!(image instanceof Blob))
    return NextResponse.json({ error: "Image is required" }, { status: 400 });
  try {
    return NextResponse.json(await classifyFoodPhoto(image));
  } catch (error) {
    if (error instanceof VisionServiceError)
      return NextResponse.json(
        { error: "Photo classification is unavailable; search manually." },
        { status: error.status && error.status < 500 ? error.status : 503 },
      );
    throw error;
  }
}
