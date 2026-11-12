import { flashcardsCreateSchema } from "@repo/schemas";
import { type NextRequest, NextResponse } from "next/server";
import { createFlashcards } from "@/lib/study/cards";
import { readBody, studyRoute } from "@/lib/study/http";

export function POST(request: NextRequest) {
  return studyRoute(request, async () => {
    const input = await readBody(request, flashcardsCreateSchema);
    return NextResponse.json(
      { cards: await createFlashcards(input) },
      { status: 201 },
    );
  });
}
