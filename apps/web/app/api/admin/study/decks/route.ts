import { deckCreateSchema } from "@repo/schemas";
import { type NextRequest, NextResponse } from "next/server";
import { createDeck, listDecks } from "@/lib/study/decks";
import { StudyValidationError } from "@/lib/study/errors";
import { readBody, studyRoute } from "@/lib/study/http";

export function GET(request: NextRequest) {
  return studyRoute(request, async () => {
    const notebookId = request.nextUrl.searchParams.get("notebookId");
    if (!notebookId) throw new StudyValidationError("notebookId is required");
    return NextResponse.json({ decks: await listDecks(notebookId) });
  });
}

export function POST(request: NextRequest) {
  return studyRoute(request, async () => {
    const input = await readBody(request, deckCreateSchema);
    return NextResponse.json(
      { deck: await createDeck(input) },
      { status: 201 },
    );
  });
}
