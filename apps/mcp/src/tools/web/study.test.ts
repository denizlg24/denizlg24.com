import { beforeEach, describe, expect, test } from "bun:test";
import type { ToolRegistrar } from "../../server";
import { createApi } from "../define";
import {
  createClient,
  type RecordedCall,
  recordingUpstream,
} from "../harness.test-util";
import { registerWebStudy } from "./study";

const register: ToolRegistrar = (server, upstream) => {
  registerWebStudy(server, createApi(upstream));
};

const { upstream, calls } = recordingUpstream();
const client = createClient(upstream, register);

const ID = "6a2150ee03ea4b5aa67b1027";
const NB = "6a2150ee03ea4b5aa67b1028";
const DECK = "6a2150ee03ea4b5aa67b1029";

function last(): RecordedCall {
  const call = calls.at(-1);
  if (!call) throw new Error("no upstream call recorded");
  return call;
}

type Case = [
  tool: string,
  args: Record<string, unknown>,
  method: string,
  path: string,
  body?: Record<string, unknown>,
];

const A = "/api/admin/study";
const K = "/api/admin/knowledge";

const READS: Case[] = [
  ["web_study_notebooks", { action: "list" }, "GET", `${A}/notebooks`],
  [
    "web_study_notebooks",
    { action: "list", archived: true },
    "GET",
    `${A}/notebooks?archived=1`,
  ],
  [
    "web_study_notebooks",
    { action: "get", id: ID },
    "GET",
    `${A}/notebooks/${ID}`,
  ],
  [
    "web_study_cards",
    { action: "decks_list", notebookId: NB },
    "GET",
    `${A}/decks?notebookId=${NB}`,
  ],
  [
    "web_study_cards",
    { action: "deck_get", id: ID },
    "GET",
    `${A}/decks/${ID}`,
  ],
  [
    "web_study_cards",
    { action: "review_queue", deckId: DECK, limit: 5 },
    "GET",
    `${A}/review?deckId=${DECK}&limit=5`,
  ],
  [
    "web_study_quizzes",
    { action: "questions_list", notebookId: NB },
    "GET",
    `${A}/questions?notebookId=${NB}`,
  ],
  [
    "web_study_quizzes",
    { action: "quizzes_list", notebookId: NB },
    "GET",
    `${A}/quizzes?notebookId=${NB}`,
  ],
  [
    "web_study_quizzes",
    { action: "quiz_get", id: ID },
    "GET",
    `${A}/quizzes/${ID}`,
  ],
  ["web_study_documents", { action: "list" }, "GET", `${A}/documents`],
  [
    "web_study_documents",
    { action: "get", id: ID },
    "GET",
    `${A}/documents/${ID}`,
  ],
  ["web_knowledge", { action: "coverage" }, "GET", `${K}/coverage`],
  [
    "web_knowledge",
    { action: "space", notebookId: NB },
    "GET",
    `${K}/space?notebookId=${NB}`,
  ],
  [
    "web_knowledge",
    { action: "retrieve", query: "fsrs", notebookId: NB, k: 4 },
    "POST",
    `${K}/retrieve`,
    { query: "fsrs", notebookId: NB, k: 4, includeArchived: false },
  ],
];

const WRITES: Case[] = [
  [
    "web_study_notebooks",
    { action: "create", title: "Algebra" },
    "POST",
    `${A}/notebooks`,
    { title: "Algebra" },
  ],
  [
    "web_study_notebooks",
    { action: "update", id: ID, archived: true },
    "PATCH",
    `${A}/notebooks/${ID}`,
    { archived: true },
  ],
  [
    "web_study_notebooks",
    { action: "delete", id: ID },
    "DELETE",
    `${A}/notebooks/${ID}`,
  ],
  [
    "web_study_notebooks",
    { action: "sources_patch", id: ID, exclude: [`note:${NB}`] },
    "PATCH",
    `${A}/notebooks/${ID}/sources`,
    { exclude: [`note:${NB}`] },
  ],
  [
    "web_study_cards",
    { action: "deck_create", notebookId: NB, title: "Ch 1" },
    "POST",
    `${A}/decks`,
    { notebookId: NB, title: "Ch 1" },
  ],
  [
    "web_study_cards",
    { action: "deck_update", id: ID, title: "Ch 2" },
    "PATCH",
    `${A}/decks/${ID}`,
    { title: "Ch 2" },
  ],
  [
    "web_study_cards",
    { action: "deck_delete", id: ID },
    "DELETE",
    `${A}/decks/${ID}`,
  ],
  [
    "web_study_cards",
    {
      action: "cards_create",
      deckId: DECK,
      cards: [{ front: "a", back: "b", sourceChunkIds: ["c1"] }],
    },
    "POST",
    `${A}/cards`,
    {
      deckId: DECK,
      cards: [{ front: "a", back: "b", sourceChunkIds: ["c1"] }],
    },
  ],
  [
    "web_study_cards",
    { action: "card_update", id: ID, suspended: true },
    "PATCH",
    `${A}/cards/${ID}`,
    { suspended: true },
  ],
  [
    "web_study_cards",
    { action: "card_delete", id: ID },
    "DELETE",
    `${A}/cards/${ID}`,
  ],
  [
    "web_study_cards",
    { action: "card_review", id: ID, rating: "good" },
    "POST",
    `${A}/cards/${ID}/review`,
    { rating: "good" },
  ],
  [
    "web_study_quizzes",
    {
      action: "questions_create",
      notebookId: NB,
      questions: [
        {
          prompt: "2+2?",
          body: { kind: "short", reference: "4" },
        },
      ],
    },
    "POST",
    `${A}/questions`,
  ],
  [
    "web_study_quizzes",
    { action: "question_update", id: ID, prompt: "x" },
    "PATCH",
    `${A}/questions/${ID}`,
    { prompt: "x" },
  ],
  [
    "web_study_quizzes",
    { action: "question_delete", id: ID },
    "DELETE",
    `${A}/questions/${ID}`,
  ],
  [
    "web_study_quizzes",
    { action: "quiz_create", notebookId: NB, title: "Q", questionIds: [ID] },
    "POST",
    `${A}/quizzes`,
    { notebookId: NB, title: "Q", questionIds: [ID] },
  ],
  [
    "web_study_quizzes",
    { action: "quiz_update", id: ID, title: "R" },
    "PATCH",
    `${A}/quizzes/${ID}`,
    { title: "R" },
  ],
  [
    "web_study_quizzes",
    { action: "quiz_delete", id: ID },
    "DELETE",
    `${A}/quizzes/${ID}`,
  ],
  [
    "web_study_quizzes",
    {
      action: "quiz_attempt",
      id: ID,
      startedAt: "2026-11-12T10:00:00.000Z",
      answers: [],
    },
    "POST",
    `${A}/quizzes/${ID}/attempts`,
  ],
  [
    "web_study_documents",
    { action: "update", id: ID, title: "T" },
    "PATCH",
    `${A}/documents/${ID}`,
    { title: "T" },
  ],
  [
    "web_study_documents",
    { action: "delete", id: ID },
    "DELETE",
    `${A}/documents/${ID}`,
  ],
  [
    "web_knowledge",
    { action: "reindex", all: true },
    "POST",
    `${K}/reindex`,
    { all: true },
  ],
];

beforeEach(() => {
  calls.length = 0;
});

describe("study tools", () => {
  for (const [tool, args, method, path, body] of [...READS, ...WRITES]) {
    test(`${tool} ${String(args.action)} routes to ${method} ${path}`, async () => {
      const result = await client.call(tool, args);
      expect(result.isError).toBeFalsy();
      expect(calls.length).toBe(1);
      expect(last().method).toBe(method);
      expect(last().path).toBe(path);
      if (body !== undefined) {
        expect(JSON.parse(last().body ?? "null")).toEqual(body);
      }
    });
  }

  for (const [tool, action] of [
    ["web_study_cards", "decks_list"],
    ["web_study_quizzes", "questions_list"],
    ["web_study_quizzes", "quizzes_list"],
  ] as const) {
    test(`${action} refuses a call without notebookId`, async () => {
      const result = await client.call(tool, { action });
      expect(result.isError).toBe(true);
      expect(calls.length).toBe(0);
    });
  }

  test("read actions are read-only and writes are not", async () => {
    const tools = await client.listTools();
    const flags = new Map<string, Record<string, { readOnly: boolean }>>();
    for (const t of tools) {
      const meta = t._meta?.["com.denizlg24/actions"] as
        | Record<string, { readOnly: boolean }>
        | undefined;
      if (meta) flags.set(t.name, meta);
    }
    for (const [tool, args] of READS) {
      expect(flags.get(tool)?.[String(args.action)]?.readOnly).toBe(true);
    }
    for (const [tool, args] of WRITES) {
      expect(flags.get(tool)?.[String(args.action)]?.readOnly).toBe(false);
    }
  });
});
