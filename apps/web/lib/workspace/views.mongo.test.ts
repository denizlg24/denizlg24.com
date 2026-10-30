import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test";
import {
  type ViewConfigInput,
  type ViewQueryResult,
  viewConfigSchema,
} from "@repo/schemas";
import type { MongoMemoryServer } from "mongodb-memory-server";
import mongoose, { type Types } from "mongoose";
import { NextRequest } from "next/server";
import type { AdminSession } from "@/lib/require-admin";
import { AgentTask } from "@/models/AgentTask";
import { CalendarEvent } from "@/models/CalendarEvent";
import { Course } from "@/models/Course";
import { CourseAssignment } from "@/models/CourseAssignment";
import { EmailModel } from "@/models/Email";
import { EmailTriageModel } from "@/models/EmailTriage";
import {
  FinanceAccount,
  FinanceEnvelope,
  FinanceLedgerEntry,
} from "@/models/Finance";
import { KanbanBoard } from "@/models/KanbanBoard";
import { KanbanCard } from "@/models/KanbanCard";
import { KanbanColumn } from "@/models/KanbanColumn";
import { LatexProject } from "@/models/LatexProject";
import { Note } from "@/models/Note";
import { Paper } from "@/models/Paper";
import { Person } from "@/models/Person";
import { PersonGroup } from "@/models/PersonGroup";
import { VoiceNote } from "@/models/VoiceNote";
import { Whiteboard } from "@/models/Whiteboard";
import { WorkspacePageModel } from "@/models/WorkspacePage";
import { resolveRecords, searchRecords } from "./records";
import { dayWindow, queryView } from "./views";

/*
 * The record resolvers and every view source's loader against a real mongod,
 * fixtures written straight to the collections (no model validation, so
 * each one holds only what the loader reads). Off by default like
 * `workspace.mongo.test.ts`; `bun run test:mongo` in apps/web runs both.
 */
const enabled = process.env.WORKSPACE_MONGO_TESTS === "1";
const MONGOD_VERSION = "8.2.1";
const TODAY = "2026-10-30";

const session: AdminSession = {
  user: { email: "owner", role: "admin" },
  via: "session",
};
if (enabled) {
  mock.module("@/lib/require-admin", () => ({
    getAdminSession: mock(async () => session),
  }));
}

const oid = () => new mongoose.Types.ObjectId();
const at = (iso: string) => new Date(iso);

function run(input: ViewConfigInput, cursor?: number) {
  return queryView(viewConfigSchema.parse(input), { today: TODAY, cursor });
}

const titles = (result: ViewQueryResult, field = "title") =>
  result.rows.map((row) => row.values[field]);

describe("dayWindow", () => {
  test("intersects date filters and widens the window a day each side", () => {
    expect(
      dayWindow(
        [
          { field: "due", op: "next_days", value: 7 },
          { field: "due", op: "on_or_before", value: "2026-11-03" },
          { field: "other", op: "on", value: "2020-01-01" },
        ],
        "due",
        TODAY,
      ),
    ).toEqual({ from: "2026-10-29", to: "2026-11-05" });
    expect(dayWindow([{ field: "due", op: "empty" }], "due", TODAY)).toBeNull();
  });
});

describe.skipIf(!enabled)("records and views on a real mongod", () => {
  let server: MongoMemoryServer;
  const ids: Record<string, Types.ObjectId> = {};

  beforeAll(async () => {
    const { MongoMemoryServer } = await import("mongodb-memory-server");
    server = await MongoMemoryServer.create({
      binary: { version: MONGOD_VERSION },
    });
    const uri = server.getUri("views-test");
    if (!/^mongodb:\/\/127\.0\.0\.1:\d+\//.test(uri)) {
      throw new Error(`Refusing a non-local mongod: ${uri}`);
    }
    await mongoose.connect(uri);
    const cache = global.mongooseCache ?? { conn: null, promise: null };
    cache.conn = mongoose;
    cache.promise = Promise.resolve(mongoose);
    global.mongooseCache = cache;

    for (const key of [
      "board",
      "archivedBoard",
      "todo",
      "done",
      "cardA",
      "cardB",
      "cardC",
      "ana",
      "friends",
      "course",
      "eur",
      "dkk",
      "email1",
      "email2",
      "note",
      "envelope",
      "paper",
      "voice",
      "latex",
      "whiteboard",
      "event",
    ]) {
      ids[key] = oid();
    }
    const id = (key: string) => {
      const value = ids[key];
      if (!value) throw new Error(key);
      return value;
    };

    await KanbanBoard.collection.insertMany([
      {
        _id: id("board"),
        title: "Life",
        isArchived: false,
        updatedAt: at("2026-10-01"),
      },
      { _id: id("archivedBoard"), title: "Old", isArchived: true },
    ]);
    await KanbanColumn.collection.insertMany([
      { _id: id("todo"), boardId: id("board"), title: "Todo", order: 0 },
      {
        _id: id("done"),
        boardId: id("board"),
        title: "Done",
        order: 1,
        isDoneColumn: true,
      },
    ]);
    await Person.collection.insertMany([
      {
        _id: id("ana"),
        name: "Ana",
        birthday: { month: 1, day: 5, year: null },
        email: "ana@example.com",
        groupIds: [id("friends")],
        updatedAt: at("2026-10-02"),
      },
    ]);
    await PersonGroup.collection.insertOne({
      _id: id("friends"),
      name: "Friends",
    });
    await KanbanCard.collection.insertMany([
      {
        _id: id("cardA"),
        boardId: id("board"),
        columnId: id("todo"),
        title: "Renew passport",
        order: 0,
        labels: ["admin"],
        priority: "high",
        dueDate: at("2026-11-02T00:00:00.000Z"),
        personIds: [String(id("ana")), "not-an-id"],
        isArchived: false,
        updatedAt: at("2026-10-20"),
      },
      {
        _id: id("cardB"),
        boardId: id("board"),
        columnId: id("done"),
        title: "Book flights",
        order: 1,
        labels: [],
        priority: "none",
        dueDate: at("2026-10-31T00:00:00.000Z"),
        isArchived: false,
        updatedAt: at("2026-10-21"),
      },
      {
        _id: id("cardC"),
        boardId: id("board"),
        columnId: id("todo"),
        title: "Archived thing",
        order: 2,
        isArchived: true,
      },
      {
        boardId: id("archivedBoard"),
        columnId: id("todo"),
        title: "On an archived board",
        order: 0,
        isArchived: false,
      },
    ]);
    await CalendarEvent.collection.insertMany([
      {
        _id: id("event"),
        title: "Dentist",
        date: at("2026-11-01T09:00:00.000Z"),
        calendarDate: "2026-11-01",
        isAllDay: false,
        kind: "manual",
        status: "scheduled",
        place: "Clinic",
      },
      {
        title: "Holiday",
        date: at("2026-12-24T00:00:00.000Z"),
        calendarDate: "2026-12-24",
        isAllDay: true,
        kind: "holiday",
        status: "scheduled",
      },
      {
        title: "Suppressed",
        date: at("2026-11-01T00:00:00.000Z"),
        calendarDate: "2026-11-01",
        kind: "holiday",
        source: {
          provider: "nager-date",
          providerKey: "x",
          isSuppressed: true,
        },
      },
    ]);
    await Note.collection.insertMany([
      {
        _id: id("note"),
        title: "Reading list",
        tags: ["Books"],
        status: "open",
        createdAt: at("2026-09-01"),
        updatedAt: at("2026-10-10"),
      },
      {
        title: "Old idea",
        tags: ["ideas"],
        status: "archived",
        updatedAt: at("2026-01-01"),
      },
    ]);
    await FinanceAccount.collection.insertOne({
      _id: id("eur"),
      displayName: "Main",
    });
    await FinanceLedgerEntry.collection.insertMany([
      {
        accountId: id("eur"),
        origin: "bank",
        state: "booked",
        amountMinor: -90_000,
        currency: "EUR",
        effectiveDate: "2026-10-01",
        descriptor: "Rent",
        category: "Housing",
      },
      {
        accountId: id("eur"),
        origin: "bank",
        state: "booked",
        amountMinor: -4_520,
        currency: "EUR",
        effectiveDate: "2026-10-12",
        descriptor: "Groceries",
        category: "Food",
      },
      {
        accountId: id("eur"),
        origin: "bank",
        state: "booked",
        amountMinor: -12_500,
        currency: "DKK",
        effectiveDate: "2026-10-14",
        descriptor: "Føtex",
        category: "Food",
      },
      {
        accountId: id("eur"),
        origin: "bank",
        state: "booked",
        amountMinor: -1_000,
        currency: "EUR",
        effectiveDate: "2026-08-01",
        descriptor: "Last summer",
        category: "Food",
      },
    ]);
    await Course.collection.insertOne({
      _id: id("course"),
      name: "Distributed Systems",
      code: "DS",
      semester: "Fall 2026",
      status: "active",
    });
    await CourseAssignment.collection.insertMany([
      {
        courseId: id("course"),
        title: "Raft lab",
        type: "lab",
        status: "in-progress",
        assessed: true,
        dueAt: at("2026-11-04T23:59:00.000Z"),
        grade: { weight: 20 },
      },
      {
        courseId: id("course"),
        title: "Midterm",
        type: "exam",
        status: "graded",
        assessed: true,
        dueAt: at("2026-10-15T09:00:00.000Z"),
        grade: { score: 17, maxScore: 20, weight: 30 },
      },
    ]);
    await EmailModel.collection.insertMany([
      {
        _id: id("email1"),
        subject: "Your invoice",
        from: [{ name: "Shop", address: "shop@example.com" }],
        date: at("2026-10-28T10:00:00.000Z"),
      },
      {
        _id: id("email2"),
        subject: "Lab moved",
        from: [{ address: "prof@uni.example" }],
        date: at("2026-10-29T10:00:00.000Z"),
      },
    ]);
    await EmailTriageModel.collection.insertMany([
      {
        emailId: id("email1"),
        category: "finance",
        userStatus: "pending",
        reviewRequired: false,
        suggestedTasks: [],
        triagedAt: at("2026-10-28T10:05:00.000Z"),
      },
      {
        emailId: id("email2"),
        category: "academic",
        userStatus: "pending",
        reviewRequired: true,
        matchedCourseName: "Distributed Systems",
        suggestedTasks: [{ title: "x" }, { title: "y" }],
        triagedAt: at("2026-10-29T10:05:00.000Z"),
      },
    ]);
    await AgentTask.collection.insertMany([
      {
        name: "Morning digest",
        prompt: "x",
        status: "active",
        origin: "owner",
        schedule: { cron: "0 7 * * *", timeZone: "Europe/Lisbon" },
        llmModel: "anthropic/claude-haiku-4.5",
        nextRunAt: at("2026-10-31T07:00:00.000Z"),
        updatedAt: at("2026-10-01"),
      },
      {
        name: "Paused",
        prompt: "x",
        status: "paused",
        origin: "agent",
        runAt: at("2026-12-01T00:00:00.000Z"),
        llmModel: "anthropic/claude-haiku-4.5",
        updatedAt: at("2026-10-02"),
      },
    ]);
    await Paper.collection.insertMany([
      {
        _id: id("paper"),
        title: "In Search of an Understandable Consensus Algorithm",
        authors: [
          { given: "Diego", family: "Ongaro" },
          { given: "John", family: "Ousterhout" },
        ],
        year: 2014,
        type: "conference",
        readingStatus: "read",
        createdAt: at("2026-09-01"),
        updatedAt: at("2026-09-01"),
      },
    ]);
    await VoiceNote.collection.insertMany([
      {
        _id: id("voice"),
        title: "Lecture 4",
        recordedAt: at("2026-10-27T14:00:00.000Z"),
        durationMs: 3_000_000,
        source: "recording",
        tags: ["ds"],
        transcription: { status: "transcribed" },
        createdAt: at("2026-10-27T15:00:00.000Z"),
        updatedAt: at("2026-10-27T15:00:00.000Z"),
      },
    ]);
    await FinanceEnvelope.collection.insertOne({
      _id: id("envelope"),
      name: "Groceries",
      kind: "capped",
      limitMinor: 40_000,
      currency: "EUR",
      period: "monthly",
      status: "active",
    });
    await LatexProject.collection.insertOne({
      _id: id("latex"),
      name: "Thesis",
      compileStatus: "ready",
      archivedAt: null,
      updatedAt: at("2026-10-29"),
    });
    await Whiteboard.collection.insertOne({
      _id: id("whiteboard"),
      name: "Today",
      updatedAt: at("2026-10-30"),
    });
    await mongoose.connection
      .collection<{
        _id: string;
        title: string;
        icon: string | null;
        deletedAt: string | null;
        purgedAt: null;
        updatedAt?: string;
      }>(WorkspacePageModel.collection.collectionName)
      .insertMany([
        {
          _id: "p1",
          title: "Week 44",
          icon: "📅",
          deletedAt: null,
          purgedAt: null,
          updatedAt: "2026-10-29T00:00:00.000Z",
        },
        {
          _id: "trashed",
          title: "Gone",
          icon: null,
          deletedAt: "2026-10-01T00:00:00.000Z",
          purgedAt: null,
        },
      ]);
  }, 600_000);

  afterAll(async () => {
    await mongoose.disconnect();
    await server?.stop();
  });

  describe("records", () => {
    test("every kind resolves; missing, trashed and malformed refs come back as missing", async () => {
      const ref = (kind: string, key: string) =>
        `entity:${kind}:${String(ids[key])}`;
      const refs = [
        "entity:page:p1",
        ref("note", "note"),
        ref("kanban-board", "board"),
        ref("kanban-card", "cardA"),
        ref("whiteboard", "whiteboard"),
        ref("person", "ana"),
        ref("course", "course"),
        ref("envelope", "envelope"),
        ref("paper", "paper"),
        ref("voice-note", "voice"),
        ref("latex-project", "latex"),
        ref("calendar-event", "event"),
        "entity:page:trashed",
        `entity:note:${String(oid())}`,
        "entity:note:not-an-object-id",
        "garbage",
      ];
      const { records, missing } = await resolveRecords(refs);
      expect(records.map((r) => r.ref)).toEqual(refs.slice(0, 12));
      expect(missing.sort()).toEqual(refs.slice(12).sort());

      const byKind = new Map(records.map((r) => [r.kind, r]));
      expect(byKind.get("page")).toMatchObject({
        title: "Week 44",
        icon: "📅",
      });
      expect(byKind.get("kanban-card")).toMatchObject({
        title: "Renew passport",
        subtitle: "Life",
      });
      expect(byKind.get("kanban-card")?.fields).toContainEqual({
        label: "Due",
        value: "2026-11-02",
      });
      expect(byKind.get("kanban-board")?.fields).toContainEqual({
        label: "Cards",
        value: "2",
      });
      expect(byKind.get("envelope")?.fields).toContainEqual({
        label: "Limit",
        value: "€400.00 / monthly",
      });
      expect(byKind.get("paper")?.subtitle).toBe("Ongaro, Ousterhout · 2014");
      expect(byKind.get("person")?.fields).toContainEqual({
        label: "Birthday",
        value: "01-05",
      });
    });

    test("search matches titles across kinds, case-insensitive", async () => {
      const found = await searchRecords("groc");
      expect(found.map((r) => [r.kind, r.title])).toEqual([
        ["envelope", "Groceries"],
      ]);
      const limited = await searchRecords("", ["page"]);
      expect(limited.map((r) => r.id)).toEqual(["p1"]);
    });
  });

  describe("view sources", () => {
    test("kanban cards: done is the board's done column; archived cards and boards stay out", async () => {
      const result = await run({
        source: "kanban-cards",
        filters: [{ field: "due", op: "next_days", value: 7 }],
      });
      expect(titles(result)).toEqual(["Book flights", "Renew passport"]);
      const [flights, passport] = result.rows;
      expect(flights?.values.done).toBe(true);
      expect(passport?.values.done).toBe(false);
      expect(passport?.values.people).toEqual([
        { id: String(ids.ana), name: "Ana" },
      ]);
      expect(passport?.ref).toBe(`entity:kanban-card:${String(ids.cardA)}`);

      const open = await run({
        source: "kanban-cards",
        layout: "board",
        filters: [
          { field: "done", op: "is", value: false },
          { field: "board", op: "is", value: "life" },
        ],
      });
      expect(titles(open)).toEqual(["Renew passport"]);
      expect(open.groups.map((g) => [g.key, g.count])).toEqual([["Todo", 1]]);
    });

    test("calendar events: a date window, suppressed events left out", async () => {
      const result = await run({
        source: "calendar-events",
        filters: [{ field: "date", op: "on", value: "2026-11-01" }],
      });
      expect(titles(result)).toEqual(["Dentist"]);
      const all = await run({ source: "calendar-events" });
      expect(titles(all)).toEqual(["Dentist", "Holiday"]);
      expect(all.rows[1]?.values.date).toBe("2026-12-24");
    });

    test("notes: status and tags filter in the database, tags case-insensitively", async () => {
      const result = await run({
        source: "notes",
        filters: [{ field: "tags", op: "is", value: "books" }],
      });
      expect(titles(result)).toEqual(["Reading list"]);
      const archived = await run({
        source: "notes",
        filters: [{ field: "status", op: "is", value: "archived" }],
      });
      expect(titles(archived)).toEqual(["Old idea"]);
    });

    test("finance entries: per-currency totals, overall and per group", async () => {
      const result = await run({
        source: "finance-entries",
        group: "category",
        filters: [{ field: "date", op: "past_days", value: 60 }],
      });
      expect(titles(result, "description")).toEqual([
        "Føtex",
        "Groceries",
        "Rent",
      ]);
      expect(result.totals).toEqual([
        { field: "amount", currency: "DKK", amountMinor: -12_500 },
        { field: "amount", currency: "EUR", amountMinor: -94_520 },
      ]);
      expect(result.groups.find((g) => g.key === "Food")?.totals).toEqual([
        { field: "amount", currency: "DKK", amountMinor: -12_500 },
        { field: "amount", currency: "EUR", amountMinor: -4_520 },
      ]);
      expect(result.rows[0]?.values.account).toBe("Main");

      const dkk = await run({
        source: "finance-entries",
        filters: [{ field: "currency", op: "is", value: "dkk" }],
      });
      expect(dkk.totals).toEqual([
        { field: "amount", currency: "DKK", amountMinor: -12_500 },
      ]);
    });

    test("course assignments open their course", async () => {
      const result = await run({
        source: "course-assignments",
        sort: [{ field: "due", dir: "asc" }],
      });
      expect(titles(result)).toEqual(["Midterm", "Raft lab"]);
      expect(result.rows[0]?.values).toMatchObject({
        course: "DS",
        score: 17,
        weight: 30,
      });
      expect(result.rows[0]?.ref).toBe(`entity:course:${String(ids.course)}`);
    });

    test("people: next birthday and group names", async () => {
      const result = await run({ source: "people" });
      expect(result.rows[0]?.values).toMatchObject({
        name: "Ana",
        birthday: "2027-01-05",
        groups: ["Friends"],
      });
    });

    test("triage joins the email for subject, sender and date", async () => {
      const result = await run({
        source: "triage",
        filters: [{ field: "review", op: "is", value: true }],
      });
      expect(result.rows.map((r) => r.values)).toEqual([
        expect.objectContaining({
          subject: "Lab moved",
          from: "prof@uni.example",
          category: "academic",
          course: "Distributed Systems",
          tasks: 2,
          received: "2026-10-29T10:00:00.000Z",
        }),
      ]);
    });

    test("agent tasks, papers and voice notes", async () => {
      const tasks = await run({
        source: "agent-tasks",
        filters: [{ field: "status", op: "is", value: "active" }],
      });
      expect(tasks.rows.map((r) => [r.values.name, r.values.schedule])).toEqual(
        [["Morning digest", "0 7 * * * (Europe/Lisbon)"]],
      );
      const papers = await run({
        source: "papers",
        filters: [{ field: "year", op: "lt", value: 2020 }],
      });
      expect(papers.rows.map((r) => r.values.authors)).toEqual([
        "Diego Ongaro, John Ousterhout",
      ]);
      const voice = await run({
        source: "voice-notes",
        filters: [{ field: "recorded", op: "past_days", value: 7 }],
      });
      expect(voice.rows.map((r) => [r.values.title, r.values.minutes])).toEqual(
        [["Lecture 4", 50]],
      );
    });

    test("the route runs an inline view and refuses a field the source lacks", async () => {
      const { POST } = await import(
        "@/app/api/admin/workspace/views/query/route"
      );
      const post = (body: object) =>
        POST(
          new NextRequest("http://localhost/api/admin/workspace/views/query", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(body),
          }),
        );
      const ok = await post({
        view: { source: "papers" },
        today: TODAY,
      });
      expect(ok.status).toBe(200);
      const bad = await post({
        view: {
          source: "papers",
          filters: [{ field: "due", op: "on", value: "2026-01-01" }],
        },
      });
      expect(bad.status).toBe(400);
      expect(await bad.json()).toMatchObject({ code: "INVALID_VIEW" });
    });
  });
});
