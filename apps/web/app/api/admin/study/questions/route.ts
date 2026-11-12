import { questionInputSchema, questionsCreateSchema } from "@repo/schemas";
import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { StudyValidationError } from "@/lib/study/errors";
import { readBody, studyRoute } from "@/lib/study/http";
import { createQuestions, listQuestions } from "@/lib/study/questions";

const singleSchema = questionsCreateSchema
  .omit({ questions: true })
  .extend({ question: questionInputSchema });

export function GET(request: NextRequest) {
  return studyRoute(request, async () => {
    const notebookId = request.nextUrl.searchParams.get("notebookId");
    if (!notebookId) throw new StudyValidationError("notebookId is required");
    return NextResponse.json({ questions: await listQuestions(notebookId) });
  });
}

export function POST(request: NextRequest) {
  return studyRoute(request, async () => {
    const input = await readBody(
      request,
      z.union([questionsCreateSchema, singleSchema]),
    );
    const questions = await createQuestions(
      "questions" in input
        ? input
        : { notebookId: input.notebookId, questions: [input.question] },
    );
    return NextResponse.json({ questions }, { status: 201 });
  });
}
