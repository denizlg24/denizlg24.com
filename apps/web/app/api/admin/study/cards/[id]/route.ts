import { flashcardUpdateSchema } from "@repo/schemas";
import { type NextRequest, NextResponse } from "next/server";
import { deleteFlashcard, updateFlashcard } from "@/lib/study/cards";
import { readBody, type StudyParams, studyRoute } from "@/lib/study/http";

export function PATCH(request: NextRequest, { params }: StudyParams) {
  return studyRoute(request, async () => {
    const { id } = await params;
    const input = await readBody(request, flashcardUpdateSchema);
    return NextResponse.json({ card: await updateFlashcard(id, input) });
  });
}

export function DELETE(request: NextRequest, { params }: StudyParams) {
  return studyRoute(request, async () => {
    const { id } = await params;
    await deleteFlashcard(id);
    return NextResponse.json({ deleted: true });
  });
}
