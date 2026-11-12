import { quizCreateSchema } from "@repo/schemas";
import { type NextRequest, NextResponse } from "next/server";
import { StudyValidationError } from "@/lib/study/errors";
import { readBody, studyRoute } from "@/lib/study/http";
import { createQuiz, listQuizzes } from "@/lib/study/quizzes";

export function GET(request: NextRequest) {
  return studyRoute(request, async () => {
    const notebookId = request.nextUrl.searchParams.get("notebookId");
    if (!notebookId) throw new StudyValidationError("notebookId is required");
    return NextResponse.json({ quizzes: await listQuizzes(notebookId) });
  });
}

export function POST(request: NextRequest) {
  return studyRoute(request, async () => {
    const input = await readBody(request, quizCreateSchema);
    return NextResponse.json(
      { quiz: await createQuiz(input) },
      { status: 201 },
    );
  });
}
