import { z } from "zod";

const objectId = z.string().regex(/^[a-f0-9]{24}$/i, "Expected an ObjectId");
const isoDate = z.string();

export const KNOWLEDGE_SOURCE_KINDS = [
  "note",
  "document",
  "voice-note",
] as const;
export const knowledgeSourceKindSchema = z.enum(KNOWLEDGE_SOURCE_KINDS);
export type KnowledgeSourceKind = z.infer<typeof knowledgeSourceKindSchema>;

/** `<kind>:<id>` — the one path a notebook filters chunks on. */
export const knowledgeSourceKeySchema = z
  .string()
  .regex(/^(note|document|voice-note):[a-f0-9]{24}$/i);
export type KnowledgeSourceKey = z.infer<typeof knowledgeSourceKeySchema>;

export function knowledgeSourceKey(
  kind: KnowledgeSourceKind,
  id: string,
): KnowledgeSourceKey {
  return `${kind}:${id}`;
}

export function parseKnowledgeSourceKey(
  key: string,
): { kind: KnowledgeSourceKind; id: string } | null {
  const parsed = knowledgeSourceKeySchema.safeParse(key);
  if (!parsed.success) return null;
  const index = key.indexOf(":");
  return {
    kind: key.slice(0, index) as KnowledgeSourceKind,
    id: key.slice(index + 1),
  };
}

export const pageRangeSchema = z.object({
  start: z.number().int().min(1),
  end: z.number().int().min(1),
});
export type PageRange = z.infer<typeof pageRangeSchema>;

export const knowledgeChunkSchema = z.object({
  _id: z.string(),
  sourceKind: knowledgeSourceKindSchema,
  sourceId: z.string(),
  sourceKey: knowledgeSourceKeySchema,
  ordinal: z.number().int().min(0),
  title: z.string(),
  headingPath: z.array(z.string()),
  page: pageRangeSchema.optional(),
  startMs: z.number().optional(),
  endMs: z.number().optional(),
  body: z.string(),
  sourceStart: z.number().int().min(0).optional(),
  sourceEnd: z.number().int().min(0).optional(),
  tokenCount: z.number().int().min(0),
  contentHash: z.string(),
  chunkerVersion: z.number().int(),
  model: z.string(),
  updatedAt: isoDate,
});
export type KnowledgeChunk = z.infer<typeof knowledgeChunkSchema>;

export const knowledgeRetrieveInputSchema = z.object({
  query: z.string().trim().min(1).max(2_000),
  notebookId: objectId.optional(),
  sourceKeys: z.array(knowledgeSourceKeySchema).max(2_000).optional(),
  k: z.number().int().min(1).max(30).default(8),
  includeArchived: z.boolean().default(false),
});
export type KnowledgeRetrieveInput = z.input<
  typeof knowledgeRetrieveInputSchema
>;

export const knowledgeHitSchema = z.object({
  chunkId: z.string(),
  sourceKey: knowledgeSourceKeySchema,
  sourceKind: knowledgeSourceKindSchema,
  sourceId: z.string(),
  title: z.string(),
  headingPath: z.array(z.string()),
  page: pageRangeSchema.optional(),
  startMs: z.number().optional(),
  endMs: z.number().optional(),
  sourceStart: z.number().int().optional(),
  sourceEnd: z.number().int().optional(),
  body: z.string(),
  contentHash: z.string(),
  score: z.number(),
  vectorRank: z.number().int().optional(),
  lexicalRank: z.number().int().optional(),
});
export type KnowledgeHit = z.infer<typeof knowledgeHitSchema>;

export const knowledgeRetrieveResponseSchema = z.object({
  hits: z.array(knowledgeHitSchema),
  sourceCount: z.number().int(),
});
export type KnowledgeRetrieveResponse = z.infer<
  typeof knowledgeRetrieveResponseSchema
>;

export const knowledgeCoverageSchema = z.object({
  sources: z.number().int(),
  embedded: z.number().int(),
  pending: z.number().int(),
  failed: z.number().int(),
  chunks: z.number().int(),
  model: z.string(),
  chunkerVersion: z.number().int(),
});
export type KnowledgeCoverage = z.infer<typeof knowledgeCoverageSchema>;

/** A notebook source as stored; a course notebook also reads the course's notes live. */
export const notebookSourceSchema = z.object({
  kind: knowledgeSourceKindSchema,
  id: objectId,
  addedAt: isoDate,
});
export type NotebookSource = z.infer<typeof notebookSourceSchema>;

export const notebookSchema = z.object({
  _id: z.string(),
  title: z.string(),
  icon: z.string().optional(),
  courseId: z.string().optional(),
  sources: z.array(notebookSourceSchema),
  excluded: z.array(knowledgeSourceKeySchema),
  archivedAt: isoDate.optional(),
  createdAt: isoDate,
  updatedAt: isoDate,
});
export type Notebook = z.infer<typeof notebookSchema>;

export const notebookSummarySchema = notebookSchema.extend({
  courseName: z.string().optional(),
  courseCode: z.string().optional(),
  sourceCount: z.number().int(),
  deckCount: z.number().int(),
  quizCount: z.number().int(),
  cardCount: z.number().int(),
  cardsDue: z.number().int(),
});
export type NotebookSummary = z.infer<typeof notebookSummarySchema>;

/** One effective source of a notebook, resolved for display. */
export const notebookResolvedSourceSchema = z.object({
  sourceKey: knowledgeSourceKeySchema,
  kind: knowledgeSourceKindSchema,
  id: z.string(),
  title: z.string(),
  origin: z.enum(["course", "explicit"]),
  excluded: z.boolean(),
  chunkCount: z.number().int(),
  status: z.enum(["embedded", "pending", "failed", "empty"]),
  updatedAt: isoDate.optional(),
});
export type NotebookResolvedSource = z.infer<
  typeof notebookResolvedSourceSchema
>;

export const notebookCreateSchema = z.object({
  title: z.string().trim().min(1).max(200),
  icon: z.string().max(64).optional(),
  courseId: objectId.optional(),
  sources: z
    .array(z.object({ kind: knowledgeSourceKindSchema, id: objectId }))
    .max(2_000)
    .optional(),
});
export type NotebookCreate = z.infer<typeof notebookCreateSchema>;

export const notebookUpdateSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  icon: z.string().max(64).nullable().optional(),
  courseId: objectId.nullable().optional(),
  archived: z.boolean().optional(),
});
export type NotebookUpdate = z.infer<typeof notebookUpdateSchema>;

export const notebookSourcesPatchSchema = z.object({
  add: z
    .array(z.object({ kind: knowledgeSourceKindSchema, id: objectId }))
    .max(500)
    .optional(),
  remove: z.array(knowledgeSourceKeySchema).max(500).optional(),
  exclude: z.array(knowledgeSourceKeySchema).max(500).optional(),
  include: z.array(knowledgeSourceKeySchema).max(500).optional(),
});
export type NotebookSourcesPatch = z.infer<typeof notebookSourcesPatchSchema>;

export const STUDY_DOCUMENT_EXTRACTION = [
  "pending",
  "ready",
  "empty",
  "failed",
] as const;
export const studyDocumentSchema = z.object({
  _id: z.string(),
  title: z.string(),
  fileName: z.string(),
  fileUrl: z.string(),
  size: z.number().int(),
  pageCount: z.number().int().optional(),
  layout: z.enum(["document", "slides"]).optional(),
  extraction: z.enum(STUDY_DOCUMENT_EXTRACTION),
  extractionError: z.string().optional(),
  courseId: z.string().optional(),
  createdAt: isoDate,
  updatedAt: isoDate,
});
export type StudyDocument = z.infer<typeof studyDocumentSchema>;

export const studyDocumentUpdateSchema = z.object({
  title: z.string().trim().min(1).max(300).optional(),
  courseId: objectId.nullable().optional(),
});
export type StudyDocumentUpdate = z.infer<typeof studyDocumentUpdateSchema>;

/** Where a generated card or question came from. */
export const studySourceRefSchema = z.object({
  chunkId: z.string(),
  sourceKey: knowledgeSourceKeySchema,
  contentHash: z.string(),
});
export type StudySourceRef = z.infer<typeof studySourceRefSchema>;

export const FSRS_STATES = ["new", "learning", "review", "relearning"] as const;
export const fsrsStateSchema = z.enum(FSRS_STATES);
export type FsrsState = z.infer<typeof fsrsStateSchema>;

export const fsrsCardStateSchema = z.object({
  due: isoDate,
  stability: z.number(),
  difficulty: z.number(),
  elapsedDays: z.number(),
  scheduledDays: z.number(),
  learningSteps: z.number().int(),
  reps: z.number().int(),
  lapses: z.number().int(),
  state: fsrsStateSchema,
  lastReview: isoDate.optional(),
});
export type FsrsCardState = z.infer<typeof fsrsCardStateSchema>;

export const REVIEW_RATINGS = ["again", "hard", "good", "easy"] as const;
export const reviewRatingSchema = z.enum(REVIEW_RATINGS);
export type ReviewRating = z.infer<typeof reviewRatingSchema>;

export const deckSchema = z.object({
  _id: z.string(),
  notebookId: z.string(),
  title: z.string(),
  description: z.string().optional(),
  cardCount: z.number().int(),
  dueCount: z.number().int(),
  newCount: z.number().int(),
  createdAt: isoDate,
  updatedAt: isoDate,
});
export type Deck = z.infer<typeof deckSchema>;

export const deckCreateSchema = z.object({
  notebookId: objectId,
  title: z.string().trim().min(1).max(200),
  description: z.string().max(2_000).optional(),
});
export type DeckCreate = z.infer<typeof deckCreateSchema>;

export const deckUpdateSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  description: z.string().max(2_000).nullable().optional(),
});
export type DeckUpdate = z.infer<typeof deckUpdateSchema>;

export const flashcardSchema = z.object({
  _id: z.string(),
  deckId: z.string(),
  notebookId: z.string(),
  front: z.string(),
  back: z.string(),
  sources: z.array(studySourceRefSchema),
  stale: z.boolean(),
  suspended: z.boolean(),
  fsrs: fsrsCardStateSchema,
  createdAt: isoDate,
  updatedAt: isoDate,
});
export type Flashcard = z.infer<typeof flashcardSchema>;

export const flashcardInputSchema = z.object({
  front: z.string().trim().min(1).max(4_000),
  back: z.string().trim().min(1).max(8_000),
  sourceChunkIds: z.array(z.string()).max(10).default([]),
});
export type FlashcardInput = z.input<typeof flashcardInputSchema>;

export const flashcardsCreateSchema = z.object({
  deckId: objectId,
  cards: z.array(flashcardInputSchema).min(1).max(100),
});
export type FlashcardsCreate = z.input<typeof flashcardsCreateSchema>;

export const flashcardUpdateSchema = z.object({
  front: z.string().trim().min(1).max(4_000).optional(),
  back: z.string().trim().min(1).max(8_000).optional(),
  suspended: z.boolean().optional(),
  deckId: objectId.optional(),
});
export type FlashcardUpdate = z.infer<typeof flashcardUpdateSchema>;

export const reviewInputSchema = z.object({
  rating: reviewRatingSchema,
  reviewedAt: isoDate.optional(),
  durationMs: z.number().int().min(0).max(3_600_000).optional(),
});
export type ReviewInput = z.infer<typeof reviewInputSchema>;

/** Next intervals per rating, for the review buttons. */
export const reviewPreviewSchema = z.record(
  reviewRatingSchema,
  z.object({ due: isoDate, scheduledDays: z.number() }),
);
export type ReviewPreview = z.infer<typeof reviewPreviewSchema>;

export const reviewQueueSchema = z.object({
  cards: z.array(flashcardSchema.extend({ preview: reviewPreviewSchema })),
  due: z.number().int(),
  new: z.number().int(),
});
export type ReviewQueue = z.infer<typeof reviewQueueSchema>;

export const QUESTION_KINDS = ["mcq", "true-false", "short"] as const;
export const questionKindSchema = z.enum(QUESTION_KINDS);
export type QuestionKind = z.infer<typeof questionKindSchema>;

export const questionBodySchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("mcq"),
    options: z.array(z.string().trim().min(1).max(1_000)).min(2).max(6),
    correctIndex: z.number().int().min(0).max(5),
  }),
  z.object({ kind: z.literal("true-false"), correct: z.boolean() }),
  z.object({
    kind: z.literal("short"),
    reference: z.string().trim().min(1).max(4_000),
  }),
]);
export type QuestionBody = z.infer<typeof questionBodySchema>;

export const questionSchema = z.object({
  _id: z.string(),
  notebookId: z.string(),
  prompt: z.string(),
  body: questionBodySchema,
  explanation: z.string().optional(),
  difficulty: z.enum(["easy", "medium", "hard"]).optional(),
  sources: z.array(studySourceRefSchema),
  stale: z.boolean(),
  wrongCount: z.number().int(),
  createdAt: isoDate,
  updatedAt: isoDate,
});
export type Question = z.infer<typeof questionSchema>;

export const questionInputSchema = z.object({
  prompt: z.string().trim().min(1).max(4_000),
  body: questionBodySchema,
  explanation: z.string().max(4_000).optional(),
  difficulty: z.enum(["easy", "medium", "hard"]).optional(),
  sourceChunkIds: z.array(z.string()).max(10).default([]),
});
export type QuestionInput = z.input<typeof questionInputSchema>;

export const questionsCreateSchema = z.object({
  notebookId: objectId,
  questions: z.array(questionInputSchema).min(1).max(100),
});
export type QuestionsCreate = z.input<typeof questionsCreateSchema>;

export const questionUpdateSchema = z.object({
  prompt: z.string().trim().min(1).max(4_000).optional(),
  body: questionBodySchema.optional(),
  explanation: z.string().max(4_000).nullable().optional(),
  difficulty: z.enum(["easy", "medium", "hard"]).nullable().optional(),
});
export type QuestionUpdate = z.infer<typeof questionUpdateSchema>;

export const quizSettingsSchema = z.object({
  shuffle: z.boolean().default(true),
  timeLimitSec: z.number().int().min(30).max(14_400).optional(),
});
export type QuizSettings = z.infer<typeof quizSettingsSchema>;

export const quizSchema = z.object({
  _id: z.string(),
  notebookId: z.string(),
  title: z.string(),
  questionIds: z.array(z.string()),
  settings: quizSettingsSchema,
  attemptCount: z.number().int(),
  bestScore: z.number().optional(),
  lastScore: z.number().optional(),
  createdAt: isoDate,
  updatedAt: isoDate,
});
export type Quiz = z.infer<typeof quizSchema>;

export const quizCreateSchema = z.object({
  notebookId: objectId,
  title: z.string().trim().min(1).max(200),
  questionIds: z.array(objectId).min(1).max(200),
  settings: quizSettingsSchema.partial().optional(),
});
export type QuizCreate = z.infer<typeof quizCreateSchema>;

export const quizUpdateSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  questionIds: z.array(objectId).min(1).max(200).optional(),
  settings: quizSettingsSchema.partial().optional(),
});
export type QuizUpdate = z.infer<typeof quizUpdateSchema>;

export const quizResponseSchema = z.union([
  z.number().int(),
  z.boolean(),
  z.string().max(8_000),
]);
export type QuizResponse = z.infer<typeof quizResponseSchema>;

export const quizAnswerSchema = z.object({
  questionId: z.string(),
  response: quizResponseSchema.nullable(),
  correct: z.boolean(),
  /** 0..1; partial credit only for short answers. */
  credit: z.number().min(0).max(1),
  feedback: z.string().optional(),
});
export type QuizAnswer = z.infer<typeof quizAnswerSchema>;

export const quizAttemptSchema = z.object({
  _id: z.string(),
  quizId: z.string(),
  notebookId: z.string(),
  answers: z.array(quizAnswerSchema),
  score: z.number().min(0).max(1),
  startedAt: isoDate,
  finishedAt: isoDate,
  durationMs: z.number().int(),
});
export type QuizAttempt = z.infer<typeof quizAttemptSchema>;

export const quizAttemptSubmitSchema = z.object({
  startedAt: isoDate,
  answers: z
    .array(
      z.object({
        questionId: objectId,
        response: quizResponseSchema.nullable(),
      }),
    )
    .max(200),
});
export type QuizAttemptSubmit = z.infer<typeof quizAttemptSubmitSchema>;

export const quizDetailSchema = z.object({
  quiz: quizSchema,
  questions: z.array(questionSchema),
  attempts: z.array(quizAttemptSchema),
});
export type QuizDetail = z.infer<typeof quizDetailSchema>;

export const notebookDetailSchema = z.object({
  notebook: notebookSummarySchema,
  sources: z.array(notebookResolvedSourceSchema),
  decks: z.array(deckSchema),
  quizzes: z.array(quizSchema),
  questionCount: z.number().int(),
  conversationId: z.string().optional(),
});
export type NotebookDetail = z.infer<typeof notebookDetailSchema>;

/** Vector-space graph: 2-D projection of source vectors, positions pinned. */
export const knowledgeSpaceNodeSchema = z.object({
  key: knowledgeSourceKeySchema,
  kind: knowledgeSourceKindSchema,
  id: z.string(),
  title: z.string(),
  x: z.number(),
  y: z.number(),
  groupIds: z.array(z.string()),
  courseIds: z.array(z.string()),
  chunkCount: z.number().int(),
});
export type KnowledgeSpaceNode = z.infer<typeof knowledgeSpaceNodeSchema>;

export const knowledgeSpaceNeighborSchema = z.object({
  key: knowledgeSourceKeySchema,
  similarity: z.number(),
});
export type KnowledgeSpaceNeighbor = z.infer<
  typeof knowledgeSpaceNeighborSchema
>;

export const knowledgeSpaceResponseSchema = z.object({
  nodes: z.array(knowledgeSpaceNodeSchema),
  neighbors: z.record(z.string(), z.array(knowledgeSpaceNeighborSchema)),
  model: z.string(),
  computedAt: isoDate.nullable(),
  /** True while a newer projection is being computed. */
  stale: z.boolean(),
  coverage: z.object({ embedded: z.number().int(), total: z.number().int() }),
});
export type KnowledgeSpaceResponse = z.infer<
  typeof knowledgeSpaceResponseSchema
>;

/** Citations the study chat renders, one per `[n]` in the answer. */
export const studyCitationSchema = knowledgeHitSchema
  .pick({
    chunkId: true,
    sourceKey: true,
    sourceKind: true,
    sourceId: true,
    title: true,
    headingPath: true,
    page: true,
    startMs: true,
    sourceStart: true,
    sourceEnd: true,
    body: true,
  })
  .extend({ n: z.number().int().min(1) });
export type StudyCitation = z.infer<typeof studyCitationSchema>;
