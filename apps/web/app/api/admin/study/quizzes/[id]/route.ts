import { quizUpdateSchema } from "@repo/schemas";
import { type NextRequest, NextResponse } from "next/server";
import { readBody, type StudyParams, studyRoute } from "@/lib/study/http";
import { deleteQuiz, getQuizDetail, updateQuiz } from "@/lib/study/quizzes";

export function GET(request: NextRequest, { params }: StudyParams) {
  return studyRoute(request, async () => {
    const { id } = await params;
    return NextResponse.json(await getQuizDetail(id));
  });
}

export function PATCH(request: NextRequest, { params }: StudyParams) {
  return studyRoute(request, async () => {
    const { id } = await params;
    const input = await readBody(request, quizUpdateSchema);
    return NextResponse.json({ quiz: await updateQuiz(id, input) });
  });
}

export function DELETE(request: NextRequest, { params }: StudyParams) {
  return studyRoute(request, async () => {
    const { id } = await params;
    await deleteQuiz(id);
    return NextResponse.json({ deleted: true });
  });
}
