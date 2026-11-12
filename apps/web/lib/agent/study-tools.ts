import {
  deckCreateSchema,
  flashcardsCreateSchema,
  type KnowledgeHit,
  knowledgeSourceKeySchema,
  questionsCreateSchema,
  quizCreateSchema,
} from "@repo/schemas";
import { type ToolSet, tool } from "ai";
import { z } from "zod";
import { bodyHashOf } from "@/lib/knowledge/body-hash";
import { retrieveKnowledge } from "@/lib/knowledge/retrieve";
import { chunksByIds } from "@/lib/knowledge/status";
import { createFlashcards } from "@/lib/study/cards";
import { createDeck, listDecks } from "@/lib/study/decks";
import { resolveNotebookSourceKeys } from "@/lib/study/notebook-sources";
import { createQuestions } from "@/lib/study/questions";
import { createQuiz } from "@/lib/study/quizzes";
import {
  type ILeanKnowledgeChunk,
  KnowledgeChunk,
} from "@/models/KnowledgeChunk";
import {
  type CitationRegistry,
  citedToolResult,
  isChunkId,
  partitionChunkIds,
  trimBody,
} from "./study-citations";

const SEARCH_BODY_CHARS = 1_200;
const READ_SOURCE_CHARS = 8_000;
const READ_SOURCE_MAX_CHUNKS = 40;

export const STUDY_WRITE_TOOLS: ReadonlySet<string> = new Set([
  "create_deck",
  "create_flashcards",
  "create_questions",
  "create_quiz",
]);

function rowToHit(row: ILeanKnowledgeChunk): KnowledgeHit {
  return {
    chunkId: row._id.toString(),
    sourceKey: row.sourceKey,
    sourceKind: row.sourceKind,
    sourceId: row.sourceId.toString(),
    title: row.title,
    headingPath: row.headingPath,
    ...(row.page ? { page: row.page } : {}),
    ...(row.startMs !== undefined ? { startMs: row.startMs } : {}),
    ...(row.endMs !== undefined ? { endMs: row.endMs } : {}),
    ...(row.sourceStart !== undefined ? { sourceStart: row.sourceStart } : {}),
    ...(row.sourceEnd !== undefined ? { sourceEnd: row.sourceEnd } : {}),
    body: row.body,
    contentHash: bodyHashOf(row),
    score: 0,
  };
}

export interface StudyToolset {
  tools: ToolSet;
  writes: ReadonlySet<string>;
}

/**
 * The study agent's tools, scoped to one notebook. `notebookId` comes from the
 * route, never from the model; chunk ids the model names are checked against
 * what the conversation retrieved or the notebook's sources.
 */
export function buildStudyTools(options: {
  notebookId: string;
  registry: CitationRegistry;
}): StudyToolset {
  const { notebookId, registry } = options;

  async function validChunkIds(ids: readonly string[]) {
    const retrieved = registry.retrieved();
    const unknown = ids.filter((id) => !retrieved.has(id) && isChunkId(id));
    const sourceKeyByChunk = new Map<string, string>();
    let notebookKeys = new Set<string>();
    if (unknown.length > 0) {
      const [hits, keys] = await Promise.all([
        chunksByIds(unknown),
        resolveNotebookSourceKeys(notebookId),
      ]);
      for (const hit of hits) sourceKeyByChunk.set(hit.chunkId, hit.sourceKey);
      notebookKeys = new Set<string>(keys);
    }
    return partitionChunkIds(ids, {
      retrieved,
      sourceKeyByChunk,
      notebookKeys,
    });
  }

  const tools: ToolSet = {
    search_notebook: tool({
      description:
        "Search the notebook's sources (hybrid semantic and keyword). Returns chunks numbered n; cite them in the answer as [n]. Call again with different wording when results miss.",
      inputSchema: z.object({
        query: z.string().trim().min(1).max(2_000),
        k: z.number().int().min(1).max(20).optional(),
      }),
      execute: async ({ query, k }) => {
        const { hits } = await retrieveKnowledge({
          query,
          notebookId,
          ...(k ? { k } : {}),
        });
        return {
          results: hits.map((hit) =>
            citedToolResult(
              hit,
              registry.register(hit),
              trimBody(hit.body, SEARCH_BODY_CHARS),
            ),
          ),
        };
      },
    }),

    read_source: tool({
      description:
        "Read consecutive chunks of one source by ordinal range (from/to inclusive, default from 0). Bounded to about 8000 characters; continue from nextOrdinal. Chunks are numbered n for citation.",
      inputSchema: z.object({
        sourceKey: knowledgeSourceKeySchema,
        from: z.number().int().min(0).optional(),
        to: z.number().int().min(0).optional(),
      }),
      execute: async ({ sourceKey, from, to }) => {
        const keys = await resolveNotebookSourceKeys(notebookId);
        if (!keys.includes(sourceKey)) {
          return { error: "sourceKey is not a source of this notebook" };
        }
        const rows = await KnowledgeChunk.find({
          sourceKey,
          ordinal: {
            $gte: from ?? 0,
            ...(to !== undefined ? { $lte: to } : {}),
          },
        })
          .sort({ ordinal: 1 })
          .limit(READ_SOURCE_MAX_CHUNKS)
          .lean<ILeanKnowledgeChunk[]>();

        const chunks: (ReturnType<typeof citedToolResult> & {
          ordinal: number;
        })[] = [];
        let used = 0;
        let nextOrdinal: number | undefined;
        for (const row of rows) {
          if (chunks.length > 0 && used + row.body.length > READ_SOURCE_CHARS) {
            nextOrdinal = row.ordinal;
            break;
          }
          used += row.body.length;
          const hit = rowToHit(row);
          chunks.push({
            ...citedToolResult(
              hit,
              registry.register(hit),
              trimBody(row.body, READ_SOURCE_CHARS),
            ),
            ordinal: row.ordinal,
          });
        }
        if (
          nextOrdinal === undefined &&
          rows.length === READ_SOURCE_MAX_CHUNKS
        ) {
          const last = rows.at(-1);
          if (last && (to === undefined || last.ordinal < to)) {
            nextOrdinal = last.ordinal + 1;
          }
        }
        return {
          sourceKey,
          title: rows[0]?.title,
          chunks,
          ...(nextOrdinal !== undefined ? { nextOrdinal } : {}),
        };
      },
    }),

    create_deck: tool({
      description: "Create an empty flashcard deck in this notebook.",
      inputSchema: deckCreateSchema.omit({ notebookId: true }),
      execute: async (input) => {
        const deck = await createDeck({ ...input, notebookId });
        return { deckId: deck._id, title: deck.title };
      },
    }),

    create_flashcards: tool({
      description:
        "Add flashcards to one of this notebook's decks in one batch. One fact per card, front a question, back short. Pass sourceChunkIds for every card.",
      inputSchema: flashcardsCreateSchema,
      execute: async (input) => {
        const decks = await listDecks(notebookId);
        if (!decks.some((deck) => deck._id === input.deckId)) {
          return { error: "deckId is not a deck of this notebook" };
        }
        let dropped = 0;
        const cards = [];
        for (const card of input.cards) {
          const { kept, dropped: bad } = await validChunkIds(
            card.sourceChunkIds,
          );
          dropped += bad.length;
          cards.push({ ...card, sourceChunkIds: kept });
        }
        const created = await createFlashcards({ ...input, cards });
        return {
          created: created.length,
          deckId: input.deckId,
          droppedSourceChunkIds: dropped,
        };
      },
    }),

    create_questions: tool({
      description:
        "Create quiz questions (multiple choice, true/false, short answer) in this notebook in one batch. Each needs an explanation and sourceChunkIds. Returns the question ids for create_quiz.",
      inputSchema: questionsCreateSchema.omit({ notebookId: true }),
      execute: async (input) => {
        let dropped = 0;
        const questions = [];
        for (const question of input.questions) {
          const { kept, dropped: bad } = await validChunkIds(
            question.sourceChunkIds,
          );
          dropped += bad.length;
          questions.push({ ...question, sourceChunkIds: kept });
        }
        const created = await createQuestions({ notebookId, questions });
        return {
          created: created.length,
          questionIds: created.map((question) => question._id),
          droppedSourceChunkIds: dropped,
        };
      },
    }),

    create_quiz: tool({
      description:
        "Create a quiz from question ids of this notebook, in order, with optional shuffle and time limit.",
      inputSchema: quizCreateSchema.omit({ notebookId: true }),
      execute: async (input) => {
        const quiz = await createQuiz({ ...input, notebookId });
        return {
          quizId: quiz._id,
          title: quiz.title,
          questions: quiz.questionIds.length,
        };
      },
    }),
  };

  return { tools, writes: STUDY_WRITE_TOOLS };
}
