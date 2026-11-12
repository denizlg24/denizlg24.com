import { reviewInputSchema } from "@repo/schemas";
import { type NextRequest, NextResponse } from "next/server";
import { readBody, type StudyParams, studyRoute } from "@/lib/study/http";
import { reviewCard } from "@/lib/study/review";

export function POST(request: NextRequest, { params }: StudyParams) {
  return studyRoute(request, async () => {
    const { id } = await params;
    const input = await readBody(request, reviewInputSchema);
    return NextResponse.json(await reviewCard(id, input));
  });
}
