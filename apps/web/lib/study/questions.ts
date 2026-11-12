import {
  type QuestionBody,
  type QuestionsCreate,
  type QuestionUpdate,
  type Question as QuestionWire,
  questionsCreateSchema,
  questionUpdateSchema,
} from "@repo/schemas";
import { connectDB } from "@/lib/mongodb";
import { Notebook } from "@/models/Notebook";
import { Quiz } from "@/models/Quiz";
import { type ILeanStudyQuestion, StudyQuestion } from "@/models/StudyQuestion";
import {
  NotebookNotFoundError,
  StudyNotFoundError,
  StudyValidationError,
  toObjectId,
} from "./errors";
import { questionToWire } from "./serialize";
import { buildSourceRefs, loadChunkHashes } from "./source-refs";

const questionMissing = (id: string) => () =>
  new StudyNotFoundError("question", id);

function assertBody(body: QuestionBody): void {
  if (body.kind === "mcq" && body.correctIndex >= body.options.length) {
    throw new StudyValidationError("correctIndex is outside the options");
  }
}

export async function createQuestions(
  input: QuestionsCreate,
): Promise<QuestionWire[]> {
  const data = questionsCreateSchema.parse(input);
  for (const question of data.questions) assertBody(question.body);
  await connectDB();
  const notebookId = toObjectId(
    data.notebookId,
    () => new NotebookNotFoundError(data.notebookId),
  );
  if (!(await Notebook.exists({ _id: notebookId }))) {
    throw new NotebookNotFoundError(data.notebookId);
  }
  const docs = await Promise.all(
    data.questions.map(async (question) => ({
      notebookId,
      prompt: question.prompt,
      body: question.body,
      ...(question.explanation ? { explanation: question.explanation } : {}),
      ...(question.difficulty ? { difficulty: question.difficulty } : {}),
      sources: await buildSourceRefs(question.sourceChunkIds),
      wrongCount: 0,
    })),
  );
  const created = await StudyQuestion.insertMany(docs);
  const questions = created.map((doc) => doc.toObject() as ILeanStudyQuestion);
  const hashes = await loadChunkHashes(questions);
  return questions.map((question) => questionToWire(question, hashes));
}

export async function listQuestions(
  notebookId: string,
): Promise<QuestionWire[]> {
  await connectDB();
  const id = toObjectId(
    notebookId,
    () => new NotebookNotFoundError(notebookId),
  );
  const questions = await StudyQuestion.find({ notebookId: id })
    .sort({ createdAt: 1 })
    .lean<ILeanStudyQuestion[]>();
  const hashes = await loadChunkHashes(questions);
  return questions.map((question) => questionToWire(question, hashes));
}

export async function updateQuestion(
  id: string,
  input: QuestionUpdate,
): Promise<QuestionWire> {
  const data = questionUpdateSchema.parse(input);
  if (data.body) assertBody(data.body);
  await connectDB();
  const questionId = toObjectId(id, questionMissing(id));
  const set: Record<string, unknown> = {};
  const unset: Record<string, ""> = {};
  if (data.prompt !== undefined) set.prompt = data.prompt;
  if (data.body !== undefined) set.body = data.body;
  if (data.explanation === null) unset.explanation = "";
  else if (data.explanation !== undefined) set.explanation = data.explanation;
  if (data.difficulty === null) unset.difficulty = "";
  else if (data.difficulty !== undefined) set.difficulty = data.difficulty;
  const question = await StudyQuestion.findByIdAndUpdate(
    questionId,
    { $set: set, $unset: unset },
    { new: true },
  ).lean<ILeanStudyQuestion>();
  if (!question) throw new StudyNotFoundError("question", id);
  const hashes = await loadChunkHashes([question]);
  return questionToWire(question, hashes);
}

export async function deleteQuestion(id: string): Promise<void> {
  await connectDB();
  const questionId = toObjectId(id, questionMissing(id));
  const deleted = await StudyQuestion.findByIdAndDelete(questionId);
  if (!deleted) throw new StudyNotFoundError("question", id);
  await Quiz.updateMany(
    { questionIds: questionId },
    { $pull: { questionIds: questionId } },
  );
}

export async function questionsByIds(
  ids: readonly string[],
): Promise<ILeanStudyQuestion[]> {
  if (ids.length === 0) return [];
  await connectDB();
  return StudyQuestion.find({ _id: { $in: ids } }).lean<ILeanStudyQuestion[]>();
}
