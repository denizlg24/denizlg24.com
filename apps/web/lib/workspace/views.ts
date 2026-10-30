import {
  entityRef,
  VIEW_SCAN_CAP,
  VIEW_SOURCES,
  type ViewConfig,
  type ViewFilter,
  type ViewPerson,
  type ViewQueryResult,
  type ViewRow,
  type ViewSourceId,
} from "@repo/schemas";
import { addDays, runViewQuery } from "@repo/utils/workspace-views";
import mongoose, { type Types } from "mongoose";
import { AgentTask } from "@/models/AgentTask";
import { CalendarEvent } from "@/models/CalendarEvent";
import { Course } from "@/models/Course";
import { CourseAssignment } from "@/models/CourseAssignment";
import { EmailModel } from "@/models/Email";
import { EmailTriageModel } from "@/models/EmailTriage";
import { FinanceAccount, FinanceLedgerEntry } from "@/models/Finance";
import { KanbanBoard } from "@/models/KanbanBoard";
import { KanbanCard } from "@/models/KanbanCard";
import { KanbanColumn } from "@/models/KanbanColumn";
import { Note } from "@/models/Note";
import { Paper } from "@/models/Paper";
import { Person } from "@/models/Person";
import { PersonGroup } from "@/models/PersonGroup";
import { VoiceNote } from "@/models/VoiceNote";

/*
 * The dispatcher behind `POST /workspace/views/query`: one loader per source
 * reads at most `VIEW_SCAN_CAP` rows (newest first) as `ViewRow`s, and the
 * shared engine (`@repo/utils/workspace-views`) filters, sorts, groups,
 * totals and pages them. A loader pushes the filters on the fields its
 * descriptor lists as `native` into the database query first, so a date
 * window over years of ledger rows does not depend on the cap. Pushdown only
 * ever narrows to a superset of what the engine keeps — date windows are
 * widened by a day either side for rows stored in another time zone — so the
 * engine's answer is the same with or without it.
 */

interface Loaded {
  rows: ViewRow[];
  truncated: boolean;
}

type Loader = (
  filters: readonly ViewFilter[],
  today: string,
) => Promise<Loaded>;

const TEXT_MAX = 300;

function clip(text: string | null | undefined): string | null {
  if (!text) return null;
  return text.length > TEXT_MAX ? `${text.slice(0, TEXT_MAX - 1)}…` : text;
}

function iso(date: Date | null | undefined): string | null {
  return date ? date.toISOString() : null;
}

function capped<T>(docs: T[]): { docs: T[]; truncated: boolean } {
  return docs.length > VIEW_SCAN_CAP
    ? { docs: docs.slice(0, VIEW_SCAN_CAP), truncated: true }
    : { docs, truncated: false };
}

function filtersOn(
  filters: readonly ViewFilter[],
  field: string,
): ViewFilter[] {
  return filters.filter((filter) => filter.field === field);
}

/**
 * The day window every date filter on `field` allows, as `[from, to)` days,
 * widened by one day on each side; null when nothing narrows it.
 */
export function dayWindow(
  filters: readonly ViewFilter[],
  field: string,
  today: string,
): { from?: string; to?: string } | null {
  let from: string | undefined;
  let to: string | undefined;
  const narrow = (lo?: string, hi?: string) => {
    if (lo && (!from || lo > from)) from = lo;
    if (hi && (!to || hi < to)) to = hi;
  };
  for (const filter of filtersOn(filters, field)) {
    const operand =
      typeof filter.value === "string" &&
      /^\d{4}-\d{2}-\d{2}$/.test(filter.value)
        ? filter.value
        : null;
    const days =
      typeof filter.value === "number"
        ? Math.max(0, Math.floor(filter.value))
        : typeof filter.value === "string" && /^\d+$/.test(filter.value)
          ? Number(filter.value)
          : null;
    switch (filter.op) {
      case "on":
        if (operand) narrow(operand, addDays(operand, 1));
        break;
      case "before":
        if (operand) narrow(undefined, operand);
        break;
      case "on_or_before":
        if (operand) narrow(undefined, addDays(operand, 1));
        break;
      case "after":
        if (operand) narrow(addDays(operand, 1));
        break;
      case "on_or_after":
        if (operand) narrow(operand);
        break;
      case "past_days":
        if (days !== null) narrow(addDays(today, -days), addDays(today, 1));
        break;
      case "next_days":
        if (days !== null) narrow(today, addDays(today, days + 1));
        break;
      default:
        break;
    }
  }
  if (!from && !to) return null;
  return {
    ...(from ? { from: addDays(from, -1) } : {}),
    ...(to ? { to: addDays(to, 1) } : {}),
  };
}

function dateRange(window: { from?: string; to?: string } | null) {
  if (!window) return null;
  return {
    ...(window.from ? { $gte: new Date(`${window.from}T00:00:00.000Z`) } : {}),
    ...(window.to ? { $lt: new Date(`${window.to}T00:00:00.000Z`) } : {}),
  };
}

function dayStringRange(window: { from?: string; to?: string } | null) {
  if (!window) return null;
  return {
    ...(window.from ? { $gte: window.from } : {}),
    ...(window.to ? { $lt: window.to } : {}),
  };
}

/** The values an `is` / `any_of` filter on `field` requires, lower-cased; null when none does. */
function requiredValues(
  filters: readonly ViewFilter[],
  field: string,
): string[] | null {
  for (const filter of filtersOn(filters, field)) {
    if (filter.op !== "is" && filter.op !== "any_of") continue;
    const values = Array.isArray(filter.value)
      ? filter.value
      : typeof filter.value === "string"
        ? [filter.value]
        : [];
    if (values.length > 0) return values.map((v) => v.toLowerCase());
  }
  return null;
}

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function exactly(values: string[]): RegExp[] {
  return values.map((v) => new RegExp(`^${escapeRegex(v)}$`, "i"));
}

function where(
  base: Record<string, unknown>,
  extra: Record<string, unknown | null>,
): Record<string, unknown> {
  const out = { ...base };
  for (const [key, value] of Object.entries(extra)) {
    if (value !== null) out[key] = value;
  }
  return out;
}

interface Lean {
  _id: Types.ObjectId;
  createdAt?: Date;
  updatedAt?: Date;
}

const LOADERS: Record<ViewSourceId, Loader> = {
  "kanban-cards": async (filters, today) => {
    const boardNames = requiredValues(filters, "board");
    const boards = await KanbanBoard.find({ isArchived: { $ne: true } })
      .select({ title: 1 })
      .lean<(Lean & { title: string })[]>();
    const boardIds = boards
      .filter((b) => !boardNames || boardNames.includes(b.title.toLowerCase()))
      .map((b) => b._id);
    const { docs, truncated } = capped(
      await KanbanCard.find(
        where(
          { isArchived: { $ne: true }, boardId: { $in: boardIds } },
          { dueDate: dateRange(dayWindow(filters, "due", today)) },
        ),
      )
        .select({
          title: 1,
          boardId: 1,
          columnId: 1,
          priority: 1,
          labels: 1,
          dueDate: 1,
          startDate: 1,
          personIds: 1,
          updatedAt: 1,
        })
        .sort({ updatedAt: -1 })
        .limit(VIEW_SCAN_CAP + 1)
        .lean<
          (Lean & {
            title: string;
            boardId: Types.ObjectId;
            columnId: Types.ObjectId;
            priority?: string;
            labels?: string[];
            dueDate?: Date;
            startDate?: Date;
            personIds?: string[];
          })[]
        >(),
    );
    const personIds = [
      ...new Set(docs.flatMap((c) => c.personIds ?? [])),
    ].filter((id) => mongoose.isValidObjectId(id));
    const [columns, people] = await Promise.all([
      KanbanColumn.find({ boardId: { $in: boardIds } })
        .select({ title: 1, isDoneColumn: 1 })
        .lean<(Lean & { title: string; isDoneColumn?: boolean })[]>(),
      personIds.length > 0
        ? Person.find({ _id: { $in: personIds } })
            .select({ name: 1 })
            .lean<(Lean & { name: string })[]>()
        : Promise.resolve([]),
    ]);
    const boardTitle = new Map(boards.map((b) => [String(b._id), b.title]));
    const column = new Map(columns.map((c) => [String(c._id), c]));
    const person = new Map(people.map((p) => [String(p._id), p.name]));
    return {
      truncated,
      rows: docs.map((card) => {
        const col = column.get(String(card.columnId));
        const cardPeople: ViewPerson[] = (card.personIds ?? []).flatMap(
          (id) => {
            const name = person.get(id);
            return name ? [{ id, name }] : [];
          },
        );
        return {
          id: String(card._id),
          ref: entityRef("kanban-card", String(card._id)),
          values: {
            title: card.title,
            board: boardTitle.get(String(card.boardId)) ?? null,
            column: col?.title ?? null,
            done: col?.isDoneColumn === true,
            priority: card.priority ?? "none",
            labels: card.labels ?? [],
            due: iso(card.dueDate),
            start: iso(card.startDate),
            people: cardPeople,
            updated: iso(card.updatedAt),
          },
        };
      }),
    };
  },

  "calendar-events": async (filters, today) => {
    const kinds = requiredValues(filters, "kind");
    const statuses = requiredValues(filters, "status");
    const { docs, truncated } = capped(
      await CalendarEvent.find(
        where(
          { "source.isSuppressed": { $ne: true } },
          {
            date: dateRange(dayWindow(filters, "date", today)),
            kind: kinds ? { $in: kinds } : null,
            status: statuses ? { $in: statuses } : null,
          },
        ),
      )
        .select({
          title: 1,
          date: 1,
          endDate: 1,
          calendarDate: 1,
          isAllDay: 1,
          kind: 1,
          status: 1,
          place: 1,
        })
        .sort({ date: -1 })
        .limit(VIEW_SCAN_CAP + 1)
        .lean<
          (Lean & {
            title: string;
            date: Date;
            endDate?: Date;
            calendarDate: string;
            isAllDay?: boolean;
            kind?: string;
            status?: string;
            place?: string;
          })[]
        >(),
    );
    return {
      truncated,
      rows: docs.map((event) => ({
        id: String(event._id),
        ref: entityRef("calendar-event", String(event._id)),
        values: {
          title: event.title,
          date: event.isAllDay ? event.calendarDate : event.date.toISOString(),
          end: iso(event.endDate),
          allDay: event.isAllDay === true,
          kind: event.kind ?? null,
          status: event.status ?? null,
          place: event.place ?? null,
        },
      })),
    };
  },

  notes: async (filters) => {
    const statuses = requiredValues(filters, "status");
    const tags = requiredValues(filters, "tags");
    const { docs, truncated } = capped(
      await Note.find(
        where(
          {},
          {
            status: statuses
              ? statuses.includes("open")
                ? { $in: [...statuses, null] }
                : { $in: statuses }
              : null,
            tags: tags ? { $in: exactly(tags) } : null,
          },
        ),
      )
        .select({
          title: 1,
          tags: 1,
          class: 1,
          status: 1,
          url: 1,
          createdAt: 1,
          updatedAt: 1,
        })
        .sort({ updatedAt: -1 })
        .limit(VIEW_SCAN_CAP + 1)
        .lean<
          (Lean & {
            title: string;
            tags?: string[];
            class?: string;
            status?: string;
            url?: string;
          })[]
        >(),
    );
    return {
      truncated,
      rows: docs.map((note) => ({
        id: String(note._id),
        ref: entityRef("note", String(note._id)),
        values: {
          title: note.title,
          tags: note.tags ?? [],
          class: note.class ?? null,
          status: note.status ?? "open",
          url: note.url ?? null,
          created: iso(note.createdAt),
          updated: iso(note.updatedAt),
        },
      })),
    };
  },

  "finance-entries": async (filters, today) => {
    const currencies = requiredValues(filters, "currency");
    const origins = requiredValues(filters, "origin");
    const states = requiredValues(filters, "state");
    const { docs, truncated } = capped(
      await FinanceLedgerEntry.find(
        where(
          {},
          {
            effectiveDate: dayStringRange(dayWindow(filters, "date", today)),
            currency: currencies
              ? { $in: currencies.map((c) => c.toUpperCase()) }
              : null,
            origin: origins ? { $in: origins } : null,
            state: states ? { $in: states } : null,
          },
        ),
      )
        .select({
          accountId: 1,
          origin: 1,
          state: 1,
          amountMinor: 1,
          currency: 1,
          effectiveDate: 1,
          descriptor: 1,
          category: 1,
          note: 1,
        })
        .sort({ effectiveDate: -1, _id: -1 })
        .limit(VIEW_SCAN_CAP + 1)
        .lean<
          (Lean & {
            accountId: Types.ObjectId;
            origin: string;
            state: string;
            amountMinor: number;
            currency: string;
            effectiveDate: string;
            descriptor: string;
            category?: string;
            note?: string;
          })[]
        >(),
    );
    const accounts = await FinanceAccount.find({
      _id: { $in: [...new Set(docs.map((d) => String(d.accountId)))] },
    })
      .select({ displayName: 1 })
      .lean<(Lean & { displayName: string })[]>();
    const account = new Map(
      accounts.map((a) => [String(a._id), a.displayName]),
    );
    return {
      truncated,
      rows: docs.map((entry) => ({
        id: String(entry._id),
        ref: null,
        values: {
          description: clip(entry.descriptor),
          amount: { amountMinor: entry.amountMinor, currency: entry.currency },
          currency: entry.currency,
          date: entry.effectiveDate,
          category: entry.category ?? null,
          account: account.get(String(entry.accountId)) ?? null,
          origin: entry.origin,
          state: entry.state,
          note: clip(entry.note),
        },
      })),
    };
  },

  "course-assignments": async (filters, today) => {
    const statuses = requiredValues(filters, "status");
    const types = requiredValues(filters, "type");
    const { docs, truncated } = capped(
      await CourseAssignment.find(
        where(
          {},
          {
            dueAt: dateRange(dayWindow(filters, "due", today)),
            status: statuses ? { $in: statuses } : null,
            type: types ? { $in: types } : null,
          },
        ),
      )
        .select({
          courseId: 1,
          title: 1,
          type: 1,
          assessed: 1,
          status: 1,
          dueAt: 1,
          submittedAt: 1,
          grade: 1,
        })
        .sort({ dueAt: -1 })
        .limit(VIEW_SCAN_CAP + 1)
        .lean<
          (Lean & {
            courseId: Types.ObjectId;
            title: string;
            type?: string;
            assessed?: boolean;
            status?: string;
            dueAt?: Date;
            submittedAt?: Date;
            grade?: { score?: number; maxScore?: number; weight?: number };
          })[]
        >(),
    );
    const courses = await Course.find({
      _id: { $in: [...new Set(docs.map((d) => String(d.courseId)))] },
    })
      .select({ name: 1, code: 1 })
      .lean<(Lean & { name: string; code?: string })[]>();
    const course = new Map(
      courses.map((c) => [String(c._id), c.code || c.name]),
    );
    return {
      truncated,
      rows: docs.map((work) => ({
        id: String(work._id),
        ref: entityRef("course", String(work.courseId)),
        values: {
          title: work.title,
          course: course.get(String(work.courseId)) ?? null,
          type: work.type ?? null,
          status: work.status ?? null,
          assessed: work.assessed !== false,
          due: iso(work.dueAt),
          submitted: iso(work.submittedAt),
          score: work.grade?.score ?? null,
          weight: work.grade?.weight ?? null,
        },
      })),
    };
  },

  people: async (_filters, today) => {
    const { docs, truncated } = capped(
      await Person.find({})
        .select({
          name: 1,
          birthday: 1,
          placeMet: 1,
          email: 1,
          phone: 1,
          groupIds: 1,
          updatedAt: 1,
        })
        .sort({ updatedAt: -1 })
        .limit(VIEW_SCAN_CAP + 1)
        .lean<
          (Lean & {
            name: string;
            birthday?: { month: number; day: number } | null;
            placeMet?: string;
            email?: string;
            phone?: string;
            groupIds?: Types.ObjectId[];
          })[]
        >(),
    );
    const groups = await PersonGroup.find({})
      .select({ name: 1 })
      .lean<(Lean & { name: string })[]>();
    const group = new Map(groups.map((g) => [String(g._id), g.name]));
    return {
      truncated,
      rows: docs.map((person) => ({
        id: String(person._id),
        ref: entityRef("person", String(person._id)),
        values: {
          name: person.name,
          birthday: person.birthday
            ? nextBirthday(person.birthday, today)
            : null,
          placeMet: clip(person.placeMet),
          email: person.email ?? null,
          phone: person.phone ?? null,
          groups: (person.groupIds ?? []).flatMap((id) => {
            const name = group.get(String(id));
            return name ? [name] : [];
          }),
          updated: iso(person.updatedAt),
        },
      })),
    };
  },

  triage: async (filters, today) => {
    const categories = requiredValues(filters, "category");
    const statuses = requiredValues(filters, "status");
    const { docs, truncated } = capped(
      await EmailTriageModel.find(
        where(
          {},
          {
            triagedAt: dateRange(dayWindow(filters, "received", today)),
            category: categories ? { $in: categories } : null,
            userStatus: statuses ? { $in: statuses } : null,
          },
        ),
      )
        .select({
          emailId: 1,
          category: 1,
          userStatus: 1,
          reviewRequired: 1,
          matchedCourseName: 1,
          summary: 1,
          suggestedTasks: 1,
          triagedAt: 1,
        })
        .sort({ triagedAt: -1 })
        .limit(VIEW_SCAN_CAP + 1)
        .lean<
          (Lean & {
            emailId: Types.ObjectId;
            category: string;
            userStatus: string;
            reviewRequired?: boolean;
            matchedCourseName?: string;
            summary?: string;
            suggestedTasks?: unknown[];
            triagedAt: Date;
          })[]
        >(),
    );
    const emails = await EmailModel.find({
      _id: { $in: docs.map((d) => d.emailId) },
    })
      .select({ subject: 1, from: 1, date: 1 })
      .lean<
        (Lean & {
          subject: string;
          from: { name?: string; address: string }[];
          date: Date;
        })[]
      >();
    const email = new Map(emails.map((e) => [String(e._id), e]));
    return {
      truncated,
      rows: docs.map((row) => {
        const message = email.get(String(row.emailId));
        const sender = message?.from[0];
        return {
          id: String(row._id),
          ref: null,
          values: {
            subject: clip(message?.subject) ?? "",
            from: sender ? sender.name || sender.address : null,
            category: row.category,
            status: row.userStatus,
            review: row.reviewRequired === true,
            course: row.matchedCourseName ?? null,
            summary: clip(row.summary),
            received: iso(message?.date ?? row.triagedAt),
            tasks: row.suggestedTasks?.length ?? 0,
          },
        };
      }),
    };
  },

  "agent-tasks": async (filters) => {
    const statuses = requiredValues(filters, "status");
    const { docs, truncated } = capped(
      await AgentTask.find(
        where({}, { status: statuses ? { $in: statuses } : null }),
      )
        .select({
          name: 1,
          status: 1,
          origin: 1,
          schedule: 1,
          runAt: 1,
          llmModel: 1,
          nextRunAt: 1,
          lastRunAt: 1,
        })
        .sort({ updatedAt: -1 })
        .limit(VIEW_SCAN_CAP + 1)
        .lean<
          (Lean & {
            name: string;
            status?: string;
            origin?: string;
            schedule?: { cron: string; timeZone: string };
            runAt?: Date;
            llmModel: string;
            nextRunAt?: Date;
            lastRunAt?: Date;
          })[]
        >(),
    );
    return {
      truncated,
      rows: docs.map((task) => ({
        id: String(task._id),
        ref: null,
        values: {
          name: task.name,
          status: task.status ?? "active",
          origin: task.origin ?? "owner",
          schedule: task.schedule
            ? `${task.schedule.cron} (${task.schedule.timeZone})`
            : task.runAt
              ? `once ${task.runAt.toISOString()}`
              : null,
          model: task.llmModel,
          nextRun: iso(task.nextRunAt),
          lastRun: iso(task.lastRunAt),
        },
      })),
    };
  },

  papers: async (filters) => {
    const reading = requiredValues(filters, "reading");
    const types = requiredValues(filters, "type");
    const { docs, truncated } = capped(
      await Paper.find(
        where(
          {},
          {
            readingStatus: reading ? { $in: reading } : null,
            type: types ? { $in: types } : null,
          },
        ),
      )
        .select({
          title: 1,
          authors: 1,
          year: 1,
          type: 1,
          readingStatus: 1,
          venue: 1,
          createdAt: 1,
        })
        .sort({ createdAt: -1 })
        .limit(VIEW_SCAN_CAP + 1)
        .lean<
          (Lean & {
            title: string;
            authors?: { family?: string; given?: string; literal?: string }[];
            year?: number;
            type?: string;
            readingStatus?: string;
            venue?: string;
          })[]
        >(),
    );
    return {
      truncated,
      rows: docs.map((paper) => ({
        id: String(paper._id),
        ref: entityRef("paper", String(paper._id)),
        values: {
          title: clip(paper.title) ?? "",
          authors: clip(
            (paper.authors ?? [])
              .map(
                (a) =>
                  a.literal ?? [a.given, a.family].filter(Boolean).join(" "),
              )
              .filter(Boolean)
              .join(", "),
          ),
          year: paper.year ?? null,
          type: paper.type ?? null,
          reading: paper.readingStatus ?? null,
          venue: clip(paper.venue),
          added: iso(paper.createdAt),
        },
      })),
    };
  },

  "voice-notes": async (filters, today) => {
    const window = dateRange(dayWindow(filters, "recorded", today));
    const { docs, truncated } = capped(
      await VoiceNote.find(
        window
          ? {
              $or: [
                { recordedAt: window },
                { recordedAt: null, createdAt: window },
              ],
            }
          : {},
      )
        .select({
          title: 1,
          recordedAt: 1,
          durationMs: 1,
          source: 1,
          tags: 1,
          "transcription.status": 1,
          createdAt: 1,
        })
        .sort({ createdAt: -1 })
        .limit(VIEW_SCAN_CAP + 1)
        .lean<
          (Lean & {
            title: string;
            recordedAt?: Date;
            durationMs?: number;
            source?: string;
            tags?: string[];
            transcription?: { status?: string };
          })[]
        >(),
    );
    return {
      truncated,
      rows: docs.map((note) => ({
        id: String(note._id),
        ref: entityRef("voice-note", String(note._id)),
        values: {
          title: note.title,
          recorded: iso(note.recordedAt ?? note.createdAt),
          minutes:
            note.durationMs !== undefined
              ? Math.round(note.durationMs / 6_000) / 10
              : null,
          source: note.source ?? null,
          tags: note.tags ?? [],
          transcript: note.transcription?.status ?? null,
        },
      })),
    };
  },
};

/** The next occurrence of a month/day on or after `today`, as `YYYY-MM-DD`. */
export function nextBirthday(
  birthday: { month: number; day: number },
  today: string,
): string {
  const year = Number(today.slice(0, 4));
  const at = (y: number) =>
    `${y}-${String(birthday.month).padStart(2, "0")}-${String(birthday.day).padStart(2, "0")}`;
  return at(year) >= today ? at(year) : at(year + 1);
}

export interface ViewQueryOptions {
  today: string;
  cursor?: number;
  limit?: number;
}

export async function queryView(
  config: ViewConfig,
  options: ViewQueryOptions,
): Promise<ViewQueryResult> {
  const descriptor = VIEW_SOURCES[config.source];
  const { rows, truncated } = await LOADERS[config.source](
    config.filters,
    options.today,
  );
  return runViewQuery(descriptor, rows, config, {
    today: options.today,
    cursor: options.cursor,
    limit: options.limit,
    scanned: rows.length,
    truncated,
  });
}
