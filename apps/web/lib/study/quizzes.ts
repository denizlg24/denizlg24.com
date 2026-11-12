import {
  type QuizAttemptSubmit,
  type QuizAttempt as QuizAttemptWire,
  type QuizCreate,
  type QuizDetail,
  type QuizUpdate,
  type Quiz as QuizWire,
  quizAttemptSubmitSchema,
  quizCreateSchema,
  quizSettingsSchema,
  quizUpdateSchema,
} from "@repo/schemas";
import mongoose from "mongoose";
import { connectDB } from "@/lib/mongodb";
import { Notebook } from "@/models/Notebook";
import { type ILeanQuiz, Quiz } from "@/models/Quiz";
import {
  type ILeanQuizAttempt,
  type IQuizAttemptAnswer,
  QuizAttemptModel,
} from "@/models/QuizAttempt";
import { type ILeanStudyQuestion, StudyQuestion } from "@/models/StudyQuestion";
import {
  NotebookNotFoundError,
  StudyNotFoundError,
  StudyValidationError,
  toObjectId,
} from "./errors";
import { gradeShortAnswer } from "./grade";
import { attemptScore, gradeObjective } from "./quiz-grading";
import { attemptToWire, questionToWire, quizToWire } from "./serialize";
import { loadChunkHashes } from "./source-refs";

const quizMissing = (id: string) => () => new StudyNotFoundError("quiz", id);
const ATTEMPTS_IN_DETAIL = 20;
const GRADING_CONCURRENCY = 4;

async function assertQuestionsBelong(
  notebookId: mongoose.Types.ObjectId,
  questionIds: readonly string[],
): Promise<mongoose.Types.ObjectId[]> {
  const unique = [...new Set(questionIds)];
  const found = await StudyQuestion.countDocuments({
    _id: { $in: unique },
    notebookId,
  });
  if (found !== unique.length) {
    throw new StudyValidationError(
      "Every question must exist in the quiz's notebook",
    );
  }
  return unique.map((id) => new mongoose.Types.ObjectId(id));
}

export async function createQuiz(input: QuizCreate): Promise<QuizWire> {
  const data = quizCreateSchema.parse(input);
  await connectDB();
  const notebookId = toObjectId(
    data.notebookId,
    () => new NotebookNotFoundError(data.notebookId),
  );
  if (!(await Notebook.exists({ _id: notebookId }))) {
    throw new NotebookNotFoundError(data.notebookId);
  }
  const questionIds = await assertQuestionsBelong(notebookId, data.questionIds);
  const created = await Quiz.create({
    notebookId,
    title: data.title,
    questionIds,
    settings: quizSettingsSchema.parse(data.settings ?? {}),
  });
  return quizToWire(created.toObject() as ILeanQuiz);
}

export async function listQuizzes(notebookId: string): Promise<QuizWire[]> {
  await connectDB();
  const id = toObjectId(
    notebookId,
    () => new NotebookNotFoundError(notebookId),
  );
  const quizzes = await Quiz.find({ notebookId: id })
    .sort({ createdAt: -1 })
    .lean<ILeanQuiz[]>();
  return quizzes.map(quizToWire);
}

export async function getQuizDetail(id: string): Promise<QuizDetail> {
  await connectDB();
  const quizId = toObjectId(id, quizMissing(id));
  const quiz = await Quiz.findById(quizId).lean<ILeanQuiz>();
  if (!quiz) throw new StudyNotFoundError("quiz", id);
  const [questions, attempts] = await Promise.all([
    StudyQuestion.find({ _id: { $in: quiz.questionIds } }).lean<
      ILeanStudyQuestion[]
    >(),
    QuizAttemptModel.find({ quizId })
      .sort({ finishedAt: -1 })
      .limit(ATTEMPTS_IN_DETAIL)
      .lean<ILeanQuizAttempt[]>(),
  ]);
  const byId = new Map(questions.map((q) => [String(q._id), q]));
  const ordered = quiz.questionIds
    .map((questionId) => byId.get(String(questionId)))
    .filter((q): q is ILeanStudyQuestion => q !== undefined);
  const hashes = await loadChunkHashes(ordered);
  return {
    quiz: quizToWire(quiz),
    questions: ordered.map((question) => questionToWire(question, hashes)),
    attempts: attempts.map(attemptToWire),
  };
}

export async function updateQuiz(
  id: string,
  input: QuizUpdate,
): Promise<QuizWire> {
  const data = quizUpdateSchema.parse(input);
  await connectDB();
  const quizId = toObjectId(id, quizMissing(id));
  const current = await Quiz.findById(quizId).lean<ILeanQuiz>();
  if (!current) throw new StudyNotFoundError("quiz", id);
  const set: Record<string, unknown> = {};
  if (data.title !== undefined) set.title = data.title;
  if (data.questionIds !== undefined) {
    set.questionIds = await assertQuestionsBelong(
      current.notebookId,
      data.questionIds,
    );
  }
  if (data.settings !== undefined) {
    set.settings = quizSettingsSchema.parse({
      ...current.settings,
      ...data.settings,
    });
  }
  const quiz = await Quiz.findByIdAndUpdate(
    quizId,
    { $set: set },
    { new: true },
  ).lean<ILeanQuiz>();
  if (!quiz) throw new StudyNotFoundError("quiz", id);
  return quizToWire(quiz);
}

export async function deleteQuiz(id: string): Promise<void> {
  await connectDB();
  const quizId = toObjectId(id, quizMissing(id));
  const deleted = await Quiz.findByIdAndDelete(quizId);
  if (!deleted) throw new StudyNotFoundError("quiz", id);
  await QuizAttemptModel.deleteMany({ quizId });
}

async function mapLimited<T, R>(
  items: readonly T[],
  limit: number,
  run: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await run(items[index] as T);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, worker),
  );
  return results;
}

interface GradedAnswer extends IQuizAttemptAnswer {
  countsAsWrong: boolean;
}

export async function submitQuizAttempt(
  id: string,
  input: QuizAttemptSubmit,
): Promise<QuizAttemptWire> {
  const data = quizAttemptSubmitSchema.parse(input);
  await connectDB();
  const quizId = toObjectId(id, quizMissing(id));
  const quiz = await Quiz.findById(quizId).lean<ILeanQuiz>();
  if (!quiz) throw new StudyNotFoundError("quiz", id);

  const startedAt = new Date(data.startedAt);
  if (Number.isNaN(startedAt.getTime())) {
    throw new StudyValidationError("startedAt is not a date");
  }
  const finishedAt = new Date();
  const questions = await StudyQuestion.find({
    _id: { $in: quiz.questionIds },
  }).lean<ILeanStudyQuestion[]>();
  const byId = new Map(questions.map((q) => [String(q._id), q]));
  const responses = new Map(
    data.answers.map((answer) => [answer.questionId, answer.response]),
  );

  const graded = await mapLimited(
    quiz.questionIds
      .map((questionId) => byId.get(String(questionId)))
      .filter((q): q is ILeanStudyQuestion => q !== undefined),
    GRADING_CONCURRENCY,
    async (question): Promise<GradedAnswer> => {
      const questionId = question._id;
      const response = responses.get(String(questionId)) ?? null;
      if (response === null) {
        return {
          questionId,
          response,
          correct: false,
          credit: 0,
          countsAsWrong: false,
        };
      }
      const objective = gradeObjective(question.body, response);
      if (objective) {
        return {
          questionId,
          response,
          ...objective,
          countsAsWrong: !objective.correct,
        };
      }
      if (typeof response !== "string") {
        return {
          questionId,
          response,
          correct: false,
          credit: 0,
          countsAsWrong: true,
        };
      }
      try {
        const verdict = await gradeShortAnswer(
          questionToWire(question, new Map()),
          response,
        );
        return {
          questionId,
          response,
          credit: verdict.credit,
          correct: verdict.correct,
          feedback: verdict.feedback,
          countsAsWrong: !verdict.correct,
        };
      } catch (error) {
        console.error("Short answer grading failed:", error);
        return {
          questionId,
          response,
          correct: false,
          credit: 0,
          feedback: "Grading unavailable.",
          countsAsWrong: false,
        };
      }
    },
  );

  const answers: IQuizAttemptAnswer[] = graded.map(
    ({ countsAsWrong: _wrong, ...answer }) => answer,
  );
  const score = attemptScore(answers);
  const attempt = await QuizAttemptModel.create({
    quizId,
    notebookId: quiz.notebookId,
    answers,
    score,
    startedAt,
    finishedAt,
    durationMs: Math.max(0, finishedAt.getTime() - startedAt.getTime()),
  });

  const wrongIds = graded
    .filter((answer) => answer.countsAsWrong)
    .map((answer) => answer.questionId);
  await Promise.all([
    wrongIds.length > 0
      ? StudyQuestion.updateMany(
          { _id: { $in: wrongIds } },
          { $inc: { wrongCount: 1 } },
        )
      : Promise.resolve(),
    Quiz.updateOne(
      { _id: quizId },
      {
        $inc: { attemptCount: 1 },
        $set: {
          lastScore: score,
          bestScore: Math.max(score, quiz.bestScore ?? 0),
        },
      },
    ),
  ]);
  return attemptToWire(attempt.toObject() as ILeanQuizAttempt);
}
