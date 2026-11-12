import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { studyRoute } from "@/lib/study/http";
import { getReviewQueue } from "@/lib/study/review";

const querySchema = z.object({
  notebookId: z.string().optional(),
  deckId: z.string().optional(),
  limit: z.coerce.number().int().min(0).max(500).optional(),
});

export function GET(request: NextRequest) {
  return studyRoute(request, async () => {
    const query = querySchema.parse(
      Object.fromEntries(request.nextUrl.searchParams),
    );
    return NextResponse.json(await getReviewQueue(query));
  });
}
