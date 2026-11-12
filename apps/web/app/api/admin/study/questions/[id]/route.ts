import { questionUpdateSchema } from "@repo/schemas";
import { type NextRequest, NextResponse } from "next/server";
import { readBody, type StudyParams, studyRoute } from "@/lib/study/http";
import { deleteQuestion, updateQuestion } from "@/lib/study/questions";

export function PATCH(request: NextRequest, { params }: StudyParams) {
  return studyRoute(request, async () => {
    const { id } = await params;
    const input = await readBody(request, questionUpdateSchema);
    return NextResponse.json({ question: await updateQuestion(id, input) });
  });
}

export function DELETE(request: NextRequest, { params }: StudyParams) {
  return studyRoute(request, async () => {
    const { id } = await params;
    await deleteQuestion(id);
    return NextResponse.json({ deleted: true });
  });
}
