import type { QuestionBody, QuizAnswer, QuizResponse } from "@repo/schemas";

export const SHORT_ANSWER_PASS_CREDIT = 0.7;

/** mcq and true-false only; a short answer needs a model and returns null here. */
export function gradeObjective(
  body: QuestionBody,
  response: QuizResponse | null,
): { credit: number; correct: boolean } | null {
  if (body.kind === "short") return null;
  const correct =
    body.kind === "mcq"
      ? response === body.correctIndex
      : response === body.correct;
  return { credit: correct ? 1 : 0, correct };
}

export function attemptScore(answers: readonly Pick<QuizAnswer, "credit">[]) {
  if (answers.length === 0) return 0;
  const total = answers.reduce((sum, answer) => sum + answer.credit, 0);
  return total / answers.length;
}
