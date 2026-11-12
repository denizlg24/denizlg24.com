import {
  type Deck,
  type DeckCreate,
  type DeckUpdate,
  deckSchema,
  type Flashcard,
  type FlashcardsCreate,
  type FlashcardUpdate,
  flashcardSchema,
  type KnowledgeChunk,
  type KnowledgeCoverage,
  type KnowledgeRetrieveInput,
  type KnowledgeRetrieveResponse,
  knowledgeChunkSchema,
  knowledgeCoverageSchema,
  knowledgeRetrieveResponseSchema,
  type Notebook,
  type NotebookCreate,
  type NotebookDetail,
  type NotebookSourcesPatch,
  type NotebookSummary,
  type NotebookUpdate,
  notebookDetailSchema,
  notebookSchema,
  notebookSummarySchema,
  type Question,
  type QuestionsCreate,
  type QuestionUpdate,
  type Quiz,
  type QuizAttempt,
  type QuizAttemptSubmit,
  type QuizCreate,
  type QuizDetail,
  type QuizUpdate,
  questionSchema,
  quizAttemptSchema,
  quizDetailSchema,
  quizSchema,
  type RecordSummary,
  type ReviewInput,
  type ReviewPreview,
  type ReviewQueue,
  recordSearchResponseSchema,
  reviewPreviewSchema,
  reviewQueueSchema,
  type StudyDocument,
  type StudyDocumentUpdate,
  studyDocumentSchema,
} from "@repo/schemas";
import { z } from "zod";
import type { AdminClient, AdminRequestOptions } from "../client";

/** Typed calls for `/api/admin/study/*` and `/api/admin/knowledge/*`. */

function query(params: Record<string, string | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value) search.set(key, value);
  }
  const text = search.toString();
  return text ? `?${text}` : "";
}

const id = (value: string) => encodeURIComponent(value);

export async function listNotebooks(
  client: AdminClient,
  opts: { archived?: boolean } = {},
  options?: AdminRequestOptions,
): Promise<NotebookSummary[]> {
  const body = await client.get<unknown>(
    `study/notebooks${query({ archived: opts.archived ? "1" : undefined })}`,
    options,
  );
  return z.object({ notebooks: z.array(notebookSummarySchema) }).parse(body)
    .notebooks;
}

export async function createNotebook(
  client: AdminClient,
  input: NotebookCreate,
): Promise<Notebook> {
  const body = await client.post<unknown>("study/notebooks", input);
  return z.object({ notebook: notebookSchema }).parse(body).notebook;
}

export async function getNotebook(
  client: AdminClient,
  notebookId: string,
  options?: AdminRequestOptions,
): Promise<NotebookDetail> {
  return notebookDetailSchema.parse(
    await client.get<unknown>(`study/notebooks/${id(notebookId)}`, options),
  );
}

export async function updateNotebook(
  client: AdminClient,
  notebookId: string,
  input: NotebookUpdate,
): Promise<Notebook> {
  const body = await client.patch<unknown>(
    `study/notebooks/${id(notebookId)}`,
    input,
  );
  return z.object({ notebook: notebookSchema }).parse(body).notebook;
}

export async function deleteNotebook(
  client: AdminClient,
  notebookId: string,
): Promise<void> {
  await client.del(`study/notebooks/${id(notebookId)}`);
}

export async function patchNotebookSources(
  client: AdminClient,
  notebookId: string,
  patch: NotebookSourcesPatch,
): Promise<NotebookDetail> {
  return notebookDetailSchema.parse(
    await client.patch<unknown>(
      `study/notebooks/${id(notebookId)}/sources`,
      patch,
    ),
  );
}

const studyThreadSchema = z.object({
  id: z.string(),
  title: z.string(),
  updatedAt: z.string(),
});
export type StudyThread = z.infer<typeof studyThreadSchema>;

export async function listStudyThreads(
  client: AdminClient,
  notebookId: string,
): Promise<StudyThread[]> {
  const body = await client.get<unknown>(
    `study/notebooks/${id(notebookId)}/chat`,
  );
  return z.object({ conversations: z.array(studyThreadSchema) }).parse(body)
    .conversations;
}

export async function listDocuments(
  client: AdminClient,
  options?: AdminRequestOptions,
): Promise<StudyDocument[]> {
  const body = await client.get<unknown>("study/documents", options);
  return z.object({ documents: z.array(studyDocumentSchema) }).parse(body)
    .documents;
}

export async function uploadDocument(
  client: AdminClient,
  input: { file: File; title?: string; notebookId?: string; courseId?: string },
  options?: AdminRequestOptions,
): Promise<StudyDocument> {
  const form = new FormData();
  form.set("file", input.file);
  if (input.title) form.set("title", input.title);
  if (input.notebookId) form.set("notebookId", input.notebookId);
  if (input.courseId) form.set("courseId", input.courseId);
  const body = await client.upload<unknown>("study/documents", form, options);
  return z.object({ document: studyDocumentSchema }).parse(body).document;
}

export async function getDocument(
  client: AdminClient,
  documentId: string,
  options?: AdminRequestOptions,
): Promise<StudyDocument> {
  const body = await client.get<unknown>(
    `study/documents/${id(documentId)}`,
    options,
  );
  return z.object({ document: studyDocumentSchema }).parse(body).document;
}

export async function updateDocument(
  client: AdminClient,
  documentId: string,
  input: StudyDocumentUpdate,
): Promise<StudyDocument> {
  const body = await client.patch<unknown>(
    `study/documents/${id(documentId)}`,
    input,
  );
  return z.object({ document: studyDocumentSchema }).parse(body).document;
}

export async function deleteDocument(
  client: AdminClient,
  documentId: string,
): Promise<void> {
  await client.del(`study/documents/${id(documentId)}`);
}

export async function listDecks(
  client: AdminClient,
  notebookId: string,
): Promise<Deck[]> {
  const body = await client.get<unknown>(`study/decks${query({ notebookId })}`);
  return z.object({ decks: z.array(deckSchema) }).parse(body).decks;
}

export async function createDeck(
  client: AdminClient,
  input: DeckCreate,
): Promise<Deck> {
  const body = await client.post<unknown>("study/decks", input);
  return z.object({ deck: deckSchema }).parse(body).deck;
}

const deckDetailSchema = z.object({
  deck: deckSchema,
  cards: z.array(flashcardSchema),
});
export type DeckDetail = z.infer<typeof deckDetailSchema>;

export async function getDeck(
  client: AdminClient,
  deckId: string,
  options?: AdminRequestOptions,
): Promise<DeckDetail> {
  return deckDetailSchema.parse(
    await client.get<unknown>(`study/decks/${id(deckId)}`, options),
  );
}

export async function updateDeck(
  client: AdminClient,
  deckId: string,
  input: DeckUpdate,
): Promise<Deck> {
  const body = await client.patch<unknown>(`study/decks/${id(deckId)}`, input);
  return z.object({ deck: deckSchema }).parse(body).deck;
}

export async function deleteDeck(
  client: AdminClient,
  deckId: string,
): Promise<void> {
  await client.del(`study/decks/${id(deckId)}`);
}

export async function createCards(
  client: AdminClient,
  input: FlashcardsCreate,
): Promise<Flashcard[]> {
  const body = await client.post<unknown>("study/cards", input);
  return z.object({ cards: z.array(flashcardSchema) }).parse(body).cards;
}

export async function updateCard(
  client: AdminClient,
  cardId: string,
  input: FlashcardUpdate,
): Promise<Flashcard> {
  const body = await client.patch<unknown>(`study/cards/${id(cardId)}`, input);
  return z.object({ card: flashcardSchema }).parse(body).card;
}

export async function deleteCard(
  client: AdminClient,
  cardId: string,
): Promise<void> {
  await client.del(`study/cards/${id(cardId)}`);
}

export async function getReviewQueue(
  client: AdminClient,
  params: { notebookId?: string; deckId?: string; limit?: number },
  options?: AdminRequestOptions,
): Promise<ReviewQueue> {
  return reviewQueueSchema.parse(
    await client.get<unknown>(
      `study/review${query({
        notebookId: params.notebookId,
        deckId: params.deckId,
        limit: params.limit ? String(params.limit) : undefined,
      })}`,
      options,
    ),
  );
}

export async function reviewCard(
  client: AdminClient,
  cardId: string,
  input: ReviewInput,
): Promise<{ card: Flashcard; preview: ReviewPreview }> {
  const body = await client.post<unknown>(
    `study/cards/${id(cardId)}/review`,
    input,
  );
  return z
    .object({ card: flashcardSchema, preview: reviewPreviewSchema })
    .parse(body);
}

export async function listQuestions(
  client: AdminClient,
  notebookId: string,
  options?: AdminRequestOptions,
): Promise<Question[]> {
  const body = await client.get<unknown>(
    `study/questions${query({ notebookId })}`,
    options,
  );
  return z.object({ questions: z.array(questionSchema) }).parse(body).questions;
}

export async function createQuestions(
  client: AdminClient,
  input: QuestionsCreate,
): Promise<Question[]> {
  const body = await client.post<unknown>("study/questions", input);
  return z.object({ questions: z.array(questionSchema) }).parse(body).questions;
}

export async function updateQuestion(
  client: AdminClient,
  questionId: string,
  input: QuestionUpdate,
): Promise<Question> {
  const body = await client.patch<unknown>(
    `study/questions/${id(questionId)}`,
    input,
  );
  return z.object({ question: questionSchema }).parse(body).question;
}

export async function deleteQuestion(
  client: AdminClient,
  questionId: string,
): Promise<void> {
  await client.del(`study/questions/${id(questionId)}`);
}

export async function listQuizzes(
  client: AdminClient,
  notebookId: string,
): Promise<Quiz[]> {
  const body = await client.get<unknown>(
    `study/quizzes${query({ notebookId })}`,
  );
  return z.object({ quizzes: z.array(quizSchema) }).parse(body).quizzes;
}

export async function createQuiz(
  client: AdminClient,
  input: QuizCreate,
): Promise<Quiz> {
  const body = await client.post<unknown>("study/quizzes", input);
  return z.object({ quiz: quizSchema }).parse(body).quiz;
}

export async function getQuiz(
  client: AdminClient,
  quizId: string,
  options?: AdminRequestOptions,
): Promise<QuizDetail> {
  return quizDetailSchema.parse(
    await client.get<unknown>(`study/quizzes/${id(quizId)}`, options),
  );
}

export async function updateQuiz(
  client: AdminClient,
  quizId: string,
  input: QuizUpdate,
): Promise<Quiz> {
  const body = await client.patch<unknown>(
    `study/quizzes/${id(quizId)}`,
    input,
  );
  return z.object({ quiz: quizSchema }).parse(body).quiz;
}

export async function deleteQuiz(
  client: AdminClient,
  quizId: string,
): Promise<void> {
  await client.del(`study/quizzes/${id(quizId)}`);
}

export async function submitQuizAttempt(
  client: AdminClient,
  quizId: string,
  input: QuizAttemptSubmit,
): Promise<QuizAttempt> {
  const body = await client.post<unknown>(
    `study/quizzes/${id(quizId)}/attempts`,
    input,
  );
  return z.object({ attempt: quizAttemptSchema }).parse(body).attempt;
}

export async function retrieveKnowledge(
  client: AdminClient,
  input: KnowledgeRetrieveInput,
): Promise<KnowledgeRetrieveResponse> {
  return knowledgeRetrieveResponseSchema.parse(
    await client.post<unknown>("knowledge/retrieve", input),
  );
}

export async function getKnowledgeCoverage(
  client: AdminClient,
): Promise<KnowledgeCoverage> {
  return knowledgeCoverageSchema.parse(
    await client.get<unknown>("knowledge/coverage"),
  );
}

export async function reindexKnowledge(
  client: AdminClient,
  input: { sourceKeys?: string[]; all?: boolean },
): Promise<number> {
  const body = await client.post<unknown>("knowledge/reindex", input);
  return z.object({ queued: z.number() }).parse(body).queued;
}

export async function getSourceChunks(
  client: AdminClient,
  sourceKey: string,
): Promise<KnowledgeChunk[]> {
  const body = await client.get<unknown>(
    `knowledge/sources/${id(sourceKey)}/chunks`,
  );
  return z.object({ chunks: z.array(knowledgeChunkSchema) }).parse(body).chunks;
}

/** Title search over notes and voice notes through the workspace record index. */
export async function searchRecords(
  client: AdminClient,
  q: string,
  kinds: ("note" | "voice-note")[],
  options?: AdminRequestOptions,
): Promise<RecordSummary[]> {
  const search = new URLSearchParams({ q });
  for (const kind of kinds) search.append("kind", kind);
  const body = await client.get<unknown>(
    `workspace/records/search?${search.toString()}`,
    options,
  );
  return recordSearchResponseSchema.parse(body).records;
}

const courseOptionSchema = z.object({
  course: z.object({
    _id: z.string(),
    name: z.string(),
    code: z.string().optional(),
  }),
});
export type CourseOption = z.infer<typeof courseOptionSchema>["course"];

export async function listCourseOptions(
  client: AdminClient,
): Promise<CourseOption[]> {
  const body = await client.get<unknown>("courses");
  return z
    .object({ courses: z.array(courseOptionSchema) })
    .parse(body)
    .courses.map((entry) => entry.course);
}
