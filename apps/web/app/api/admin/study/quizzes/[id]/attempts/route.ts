import { quizAttemptSubmitSchema } from "@repo/schemas";
import { type NextRequest, NextResponse } from "next/server";
import { readBody, type StudyParams, studyRoute } from "@/lib/study/http";
import { submitQuizAttempt } from "@/lib/study/quizzes";

export function POST(request: NextRequest, { params }: StudyParams) {
  return studyRoute(request, async () => {
    const { id } = await params;
    const input = await readBody(request, quizAttemptSubmitSchema);
    return NextResponse.json(
      { attempt: await submitQuizAttempt(id, input) },
      { status: 201 },
    );
  });
}
