import { deckUpdateSchema } from "@repo/schemas";
import { type NextRequest, NextResponse } from "next/server";
import { deleteDeck, getDeck, updateDeck } from "@/lib/study/decks";
import { readBody, type StudyParams, studyRoute } from "@/lib/study/http";

export function GET(request: NextRequest, { params }: StudyParams) {
  return studyRoute(request, async () => {
    const { id } = await params;
    return NextResponse.json(await getDeck(id));
  });
}

export function PATCH(request: NextRequest, { params }: StudyParams) {
  return studyRoute(request, async () => {
    const { id } = await params;
    const input = await readBody(request, deckUpdateSchema);
    return NextResponse.json({ deck: await updateDeck(id, input) });
  });
}

export function DELETE(request: NextRequest, { params }: StudyParams) {
  return studyRoute(request, async () => {
    const { id } = await params;
    await deleteDeck(id);
    return NextResponse.json({ deleted: true });
  });
}
