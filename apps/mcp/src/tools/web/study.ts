import type { McpServer } from "@modelcontextprotocol/server";
import {
  deckCreateSchema,
  deckUpdateSchema,
  flashcardsCreateSchema,
  flashcardUpdateSchema,
  knowledgeRetrieveInputSchema,
  knowledgeSourceKeySchema,
  notebookCreateSchema,
  notebookSourcesPatchSchema,
  notebookUpdateSchema,
  questionsCreateSchema,
  questionUpdateSchema,
  quizAttemptSubmitSchema,
  quizCreateSchema,
  quizUpdateSchema,
  reviewInputSchema,
  studyDocumentUpdateSchema,
} from "@repo/schemas";
import { z } from "zod";
import { type Api, action, defineActions, p } from "../define";

const id = z.string().min(1).describe("Record _id");
const byId = z.object({ id });
const notebookId = z.string().min(1).describe("Notebook _id");
const deckId = z.string().min(1).describe("Deck _id");

const BASE = "/api/admin/study";
const KNOWLEDGE = "/api/admin/knowledge";

export function registerWebStudy(server: McpServer, api: Api) {
  defineActions(server, {
    name: "web_study_notebooks",
    title: "Web: study notebooks",
    description:
      "Study notebooks: a named set of notes, voice notes and documents that decks, questions and quizzes belong to.",
    actions: {
      list: action({
        description: "Every notebook; archived ones only with archived",
        input: z.object({ archived: z.boolean().optional() }),
        readOnly: true,
        run: ({ archived }) =>
          api.web.get(`${BASE}/notebooks`, {
            archived: archived ? 1 : undefined,
          }),
      }),
      get: action({
        description: "One notebook with its sources, decks and quizzes",
        input: byId,
        readOnly: true,
        run: ({ id }) => api.web.get(p`/api/admin/study/notebooks/${id}`),
      }),
      create: action({
        description: "Adds a notebook, optionally with sources",
        input: z.object(notebookCreateSchema.shape),
        run: (body) => api.web.post(`${BASE}/notebooks`, body),
      }),
      update: action({
        description: "Changes title, icon, courseId or archived",
        input: z.object({ id, ...notebookUpdateSchema.shape }),
        idempotent: true,
        run: ({ id, ...body }) =>
          api.web.patch(p`/api/admin/study/notebooks/${id}`, body),
      }),
      delete: action({
        description: "Deletes a notebook with its decks, questions and quizzes",
        input: byId,
        destructive: true,
        run: ({ id }) => api.web.delete(p`/api/admin/study/notebooks/${id}`),
      }),
      sources_patch: action({
        description:
          "Adds, removes, excludes or includes sources (keys are <kind>:<id>)",
        input: z.object({ id, ...notebookSourcesPatchSchema.shape }),
        run: ({ id, ...body }) =>
          api.web.patch(p`/api/admin/study/notebooks/${id}/sources`, body),
      }),
    },
  });

  defineActions(server, {
    name: "web_study_cards",
    title: "Web: study flashcards",
    description: "Flashcard decks, cards and spaced-repetition review.",
    actions: {
      decks_list: action({
        description: "Decks of one notebook",
        input: z.object({ notebookId }),
        readOnly: true,
        run: ({ notebookId }) => api.web.get(`${BASE}/decks`, { notebookId }),
      }),
      deck_get: action({
        description: "One deck with its cards",
        input: byId,
        readOnly: true,
        run: ({ id }) => api.web.get(p`/api/admin/study/decks/${id}`),
      }),
      deck_create: action({
        description: "Adds a deck to a notebook",
        input: z.object(deckCreateSchema.shape),
        run: (body) => api.web.post(`${BASE}/decks`, body),
      }),
      deck_update: action({
        description: "Changes title or description",
        input: z.object({ id, ...deckUpdateSchema.shape }),
        idempotent: true,
        run: ({ id, ...body }) =>
          api.web.patch(p`/api/admin/study/decks/${id}`, body),
      }),
      deck_delete: action({
        description: "Deletes a deck with its cards",
        input: byId,
        destructive: true,
        run: ({ id }) => api.web.delete(p`/api/admin/study/decks/${id}`),
      }),
      cards_create: action({
        description:
          "Adds cards to a deck; pass sourceChunkIds from retrieve hits",
        input: z.object(flashcardsCreateSchema.shape),
        run: (body) => api.web.post(`${BASE}/cards`, body),
      }),
      card_update: action({
        description: "Changes front, back, suspended, or moves it with deckId",
        input: z.object({ id, ...flashcardUpdateSchema.shape }),
        idempotent: true,
        run: ({ id, ...body }) =>
          api.web.patch(p`/api/admin/study/cards/${id}`, body),
      }),
      card_delete: action({
        description: "Deletes a card",
        input: byId,
        destructive: true,
        run: ({ id }) => api.web.delete(p`/api/admin/study/cards/${id}`),
      }),
      review_queue: action({
        description: "Due and new cards, optionally of one notebook or deck",
        input: z.object({
          notebookId: notebookId.optional(),
          deckId: deckId.optional(),
          limit: z.number().int().min(1).optional(),
        }),
        readOnly: true,
        run: (query) => api.web.get(`${BASE}/review`, query),
      }),
      card_review: action({
        description: "Records a review rating: again, hard, good or easy",
        input: z.object({ id, ...reviewInputSchema.shape }),
        run: ({ id, ...body }) =>
          api.web.post(p`/api/admin/study/cards/${id}/review`, body),
      }),
    },
  });

  defineActions(server, {
    name: "web_study_quizzes",
    title: "Web: study quizzes",
    description: "Practice questions, quizzes built from them, and attempts.",
    actions: {
      questions_list: action({
        description: "Questions of one notebook",
        input: z.object({ notebookId }),
        readOnly: true,
        run: ({ notebookId }) =>
          api.web.get(`${BASE}/questions`, { notebookId }),
      }),
      questions_create: action({
        description:
          "Adds questions to a notebook; pass sourceChunkIds from retrieve hits",
        input: z.object(questionsCreateSchema.shape),
        run: (body) => api.web.post(`${BASE}/questions`, body),
      }),
      question_update: action({
        description: "Changes prompt, body, explanation or difficulty",
        input: z.object({ id, ...questionUpdateSchema.shape }),
        idempotent: true,
        run: ({ id, ...body }) =>
          api.web.patch(p`/api/admin/study/questions/${id}`, body),
      }),
      question_delete: action({
        description: "Deletes a question",
        input: byId,
        destructive: true,
        run: ({ id }) => api.web.delete(p`/api/admin/study/questions/${id}`),
      }),
      quizzes_list: action({
        description: "Quizzes of one notebook",
        input: z.object({ notebookId }),
        readOnly: true,
        run: ({ notebookId }) => api.web.get(`${BASE}/quizzes`, { notebookId }),
      }),
      quiz_get: action({
        description: "One quiz with its questions and attempts",
        input: byId,
        readOnly: true,
        run: ({ id }) => api.web.get(p`/api/admin/study/quizzes/${id}`),
      }),
      quiz_create: action({
        description: "Builds a quiz from existing question ids",
        input: z.object(quizCreateSchema.shape),
        run: (body) => api.web.post(`${BASE}/quizzes`, body),
      }),
      quiz_update: action({
        description: "Changes title, questionIds or settings",
        input: z.object({ id, ...quizUpdateSchema.shape }),
        idempotent: true,
        run: ({ id, ...body }) =>
          api.web.patch(p`/api/admin/study/quizzes/${id}`, body),
      }),
      quiz_delete: action({
        description: "Deletes a quiz with its attempts",
        input: byId,
        destructive: true,
        run: ({ id }) => api.web.delete(p`/api/admin/study/quizzes/${id}`),
      }),
      quiz_attempt: action({
        description: "Submits and grades an attempt",
        input: z.object({ id, ...quizAttemptSubmitSchema.shape }),
        run: ({ id, ...body }) =>
          api.web.post(p`/api/admin/study/quizzes/${id}/attempts`, body),
      }),
    },
  });

  defineActions(server, {
    name: "web_study_documents",
    title: "Web: study documents",
    description:
      "Uploaded PDFs indexed for study. Upload itself is not available here.",
    actions: {
      list: action({
        description: "Every document",
        readOnly: true,
        run: () => api.web.get(`${BASE}/documents`),
      }),
      get: action({
        description: "One document",
        input: byId,
        readOnly: true,
        run: ({ id }) => api.web.get(p`/api/admin/study/documents/${id}`),
      }),
      update: action({
        description: "Changes title or courseId",
        input: z.object({ id, ...studyDocumentUpdateSchema.shape }),
        idempotent: true,
        run: ({ id, ...body }) =>
          api.web.patch(p`/api/admin/study/documents/${id}`, body),
      }),
      delete: action({
        description: "Deletes a document and its chunks",
        input: byId,
        destructive: true,
        run: ({ id }) => api.web.delete(p`/api/admin/study/documents/${id}`),
      }),
    },
  });

  defineActions(server, {
    name: "web_knowledge",
    title: "Web: knowledge index",
    description:
      "Chunk-level retrieval over notes, voice notes and documents, and the index's health.",
    actions: {
      retrieve: action({
        description:
          "Top chunks for a query, optionally scoped to a notebook or source keys",
        input: z.object(knowledgeRetrieveInputSchema.shape),
        readOnly: true,
        run: (body) => api.web.post(`${KNOWLEDGE}/retrieve`, body),
      }),
      coverage: action({
        description: "How much of the corpus is embedded",
        readOnly: true,
        run: () => api.web.get(`${KNOWLEDGE}/coverage`),
      }),
      reindex: action({
        description: "Queues sources for re-embedding, or everything with all",
        input: z.object({
          sourceKeys: z.array(knowledgeSourceKeySchema).optional(),
          all: z.boolean().optional(),
        }),
        idempotent: true,
        run: (body) => api.web.post(`${KNOWLEDGE}/reindex`, body),
      }),
      space: action({
        description: "2D map of sources, optionally of one notebook",
        input: z.object({ notebookId: notebookId.optional() }),
        readOnly: true,
        run: ({ notebookId }) =>
          api.web.get(`${KNOWLEDGE}/space`, { notebookId }),
      }),
    },
  });
}
