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
import { Blog } from "@/models/Blog";
import { CalendarEvent } from "@/models/CalendarEvent";
import { Contact } from "@/models/Contact";
import { Course } from "@/models/Course";
import { CourseAssignment } from "@/models/CourseAssignment";
import { EmailModel } from "@/models/Email";
import { EmailAccountModel } from "@/models/EmailAccount";
import { EmailTriageModel } from "@/models/EmailTriage";
import {
  FinanceAccount,
  FinanceLedgerEntry,
  FinanceRecurringRule,
} from "@/models/Finance";
import { JournalLog } from "@/models/Journal";
import { KanbanBoard } from "@/models/KanbanBoard";
import { KanbanCard } from "@/models/KanbanCard";
import { KanbanColumn } from "@/models/KanbanColumn";
import { Note } from "@/models/Note";
import { Paper } from "@/models/Paper";
import { Person } from "@/models/Person";
import { PersonGroup } from "@/models/PersonGroup";
import { Project } from "@/models/Project";
import { Resource } from "@/models/Resource";
import { Spreadsheet } from "@/models/Spreadsheet";
import TimelineItem from "@/models/TimelineItem";
import { TimetableEntry } from "@/models/TimetableEntry";
import { VoiceNote } from "@/models/VoiceNote";
import { WorkJob, WorkSession } from "@/models/WorkHours";

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
        ref: entityRef("finance-entry", String(entry._id)),
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
        ref: entityRef("agent-task", String(task._id)),
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

  "blog-posts": async (filters, today) => {
    const { docs, truncated } = capped(
      await Blog.find(
        where(
          {},
          { createdAt: dateRange(dayWindow(filters, "created", today)) },
        ),
      )
        .select({
          title: 1,
          slug: 1,
          excerpt: 1,
          tags: 1,
          isActive: 1,
          timeToRead: 1,
          createdAt: 1,
          updatedAt: 1,
        })
        .sort({ createdAt: -1 })
        .limit(VIEW_SCAN_CAP + 1)
        .lean<
          (Lean & {
            title: string;
            slug: string;
            excerpt?: string;
            tags?: string[];
            isActive?: boolean;
            timeToRead?: number;
          })[]
        >(),
    );
    return {
      truncated,
      rows: docs.map((post) => ({
        id: String(post._id),
        ref: entityRef("blog-post", String(post._id)),
        values: {
          title: post.title,
          slug: post.slug,
          excerpt: clip(post.excerpt),
          tags: post.tags ?? [],
          published: post.isActive === true,
          minutes: post.timeToRead ?? null,
          created: iso(post.createdAt),
          updated: iso(post.updatedAt),
        },
      })),
    };
  },

  projects: async () => {
    const { docs, truncated } = capped(
      await Project.find({})
        .select({
          title: 1,
          subtitle: 1,
          tags: 1,
          isActive: 1,
          isFeatured: 1,
          sourceRepository: 1,
          order: 1,
          updatedAt: 1,
        })
        .sort({ updatedAt: -1 })
        .limit(VIEW_SCAN_CAP + 1)
        .lean<
          (Lean & {
            title: string;
            subtitle?: string;
            tags?: string[];
            isActive?: boolean;
            isFeatured?: boolean;
            sourceRepository?: { owner: string; repo: string };
            order?: number;
          })[]
        >(),
    );
    return {
      truncated,
      rows: docs.map((project) => ({
        id: String(project._id),
        ref: entityRef("project", String(project._id)),
        values: {
          title: project.title,
          subtitle: clip(project.subtitle),
          tags: project.tags ?? [],
          active: project.isActive === true,
          featured: project.isFeatured === true,
          repository: project.sourceRepository
            ? `${project.sourceRepository.owner}/${project.sourceRepository.repo}`
            : null,
          order: project.order ?? null,
          updated: iso(project.updatedAt),
        },
      })),
    };
  },

  timeline: async () => {
    const { docs, truncated } = capped(
      await TimelineItem.find({})
        .select({
          title: 1,
          subtitle: 1,
          category: 1,
          dateFrom: 1,
          dateTo: 1,
          topics: 1,
          isActive: 1,
          order: 1,
        })
        .sort({ updatedAt: -1 })
        .limit(VIEW_SCAN_CAP + 1)
        .lean<
          (Lean & {
            title: string;
            subtitle?: string;
            category?: string;
            dateFrom: string;
            dateTo?: string;
            topics?: string[];
            isActive?: boolean;
            order?: number;
          })[]
        >(),
    );
    return {
      truncated,
      rows: docs.map((item) => ({
        id: String(item._id),
        ref: entityRef("timeline-item", String(item._id)),
        values: {
          title: item.title,
          subtitle: clip(item.subtitle),
          category: item.category ?? null,
          from: item.dateFrom,
          to: item.dateTo || null,
          topics: item.topics ?? [],
          active: item.isActive === true,
          order: item.order ?? null,
        },
      })),
    };
  },

  contacts: async (filters, today) => {
    const statuses = requiredValues(filters, "status");
    const { docs, truncated } = capped(
      await Contact.find(
        where(
          {},
          {
            createdAt: dateRange(dayWindow(filters, "received", today)),
            status: statuses ? { $in: statuses } : null,
          },
        ),
      )
        .select({
          ticketId: 1,
          name: 1,
          email: 1,
          message: 1,
          status: 1,
          emailSent: 1,
          createdAt: 1,
        })
        .sort({ createdAt: -1 })
        .limit(VIEW_SCAN_CAP + 1)
        .lean<
          (Lean & {
            ticketId: string;
            name: string;
            email: string;
            message?: string;
            status?: string;
            emailSent?: boolean;
          })[]
        >(),
    );
    return {
      truncated,
      rows: docs.map((contact) => ({
        id: contact.ticketId,
        ref: entityRef("contact", contact.ticketId),
        values: {
          name: contact.name,
          email: contact.email,
          message: clip(contact.message),
          status: contact.status ?? null,
          replied: contact.emailSent === true,
          received: iso(contact.createdAt),
        },
      })),
    };
  },

  emails: async (filters, today) => {
    const accountNames = requiredValues(filters, "account");
    const accounts = await EmailAccountModel.find({})
      .select({ displayName: 1, user: 1 })
      .lean<(Lean & { displayName?: string; user: string })[]>();
    const accountName = new Map(
      accounts.map((a) => [String(a._id), a.displayName || a.user]),
    );
    const accountIds = accountNames
      ? accounts
          .filter((a) =>
            accountNames.includes((a.displayName || a.user).toLowerCase()),
          )
          .map((a) => a._id)
      : null;
    const { docs, truncated } = capped(
      await EmailModel.find(
        where(
          {},
          {
            date: dateRange(dayWindow(filters, "received", today)),
            accountId: accountIds ? { $in: accountIds } : null,
          },
        ),
      )
        .select({ accountId: 1, subject: 1, from: 1, date: 1, seen: 1 })
        .sort({ date: -1 })
        .limit(VIEW_SCAN_CAP + 1)
        .lean<
          (Lean & {
            accountId: Types.ObjectId;
            subject?: string;
            from?: { name?: string; address: string }[];
            date: Date;
            seen?: boolean;
          })[]
        >(),
    );
    return {
      truncated,
      rows: docs.map((email) => {
        const sender = email.from?.[0];
        return {
          id: String(email._id),
          ref: entityRef("email", String(email._id)),
          values: {
            subject: clip(email.subject) ?? "",
            from: sender ? sender.name || sender.address : null,
            account: accountName.get(String(email.accountId)) ?? null,
            received: iso(email.date),
            seen: email.seen === true,
          },
        };
      }),
    };
  },

  "finance-accounts": async () => {
    const { docs, truncated } = capped(
      await FinanceAccount.find({})
        .select({
          displayName: 1,
          institutionName: 1,
          currency: 1,
          provider: 1,
          connectionStatus: 1,
          lastSyncedAt: 1,
          accessValidUntil: 1,
        })
        .sort({ updatedAt: -1 })
        .limit(VIEW_SCAN_CAP + 1)
        .lean<
          (Lean & {
            displayName: string;
            institutionName: string;
            currency: string;
            provider: string;
            connectionStatus: string;
            lastSyncedAt?: Date;
            accessValidUntil?: Date;
          })[]
        >(),
    );
    return {
      truncated,
      rows: docs.map((account) => ({
        id: String(account._id),
        ref: entityRef("finance-account", String(account._id)),
        values: {
          name: account.displayName,
          institution: account.institutionName,
          currency: account.currency,
          provider: account.provider,
          connection: account.connectionStatus,
          lastSynced: iso(account.lastSyncedAt),
          accessUntil: iso(account.accessValidUntil),
        },
      })),
    };
  },

  "finance-rules": async (filters) => {
    const statuses = requiredValues(filters, "status");
    const directions = requiredValues(filters, "direction");
    const currencies = requiredValues(filters, "currency");
    const { docs, truncated } = capped(
      await FinanceRecurringRule.find(
        where(
          {},
          {
            status: statuses ? { $in: statuses } : null,
            direction: directions ? { $in: directions } : null,
            currency: currencies
              ? { $in: currencies.map((c) => c.toUpperCase()) }
              : null,
          },
        ),
      )
        .select({
          accountId: 1,
          name: 1,
          direction: 1,
          amountKind: 1,
          amountMinor: 1,
          currency: 1,
          anchorDate: 1,
          status: 1,
          endDate: 1,
          payout: 1,
        })
        .sort({ updatedAt: -1 })
        .limit(VIEW_SCAN_CAP + 1)
        .lean<
          (Lean & {
            accountId: Types.ObjectId;
            name: string;
            direction: string;
            amountKind: string;
            amountMinor: number;
            currency: string;
            anchorDate: string;
            status: string;
            endDate?: string;
            payout?: unknown;
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
      rows: docs.map((rule) => ({
        id: String(rule._id),
        ref: entityRef("finance-rule", String(rule._id)),
        values: {
          name: rule.name,
          direction: rule.direction,
          amount: { amountMinor: rule.amountMinor, currency: rule.currency },
          currency: rule.currency,
          amountKind: rule.amountKind,
          status: rule.status,
          account: account.get(String(rule.accountId)) ?? null,
          payout: rule.payout !== undefined && rule.payout !== null,
          anchor: rule.anchorDate,
          ends: rule.endDate ?? null,
        },
      })),
    };
  },

  journal: async (filters, today) => {
    const { docs, truncated } = capped(
      await JournalLog.find(
        where({}, { date: dateRange(dayWindow(filters, "date", today)) }),
      )
        .select({ date: 1, content: 1, events: 1, notes: 1 })
        .sort({ date: -1 })
        .limit(VIEW_SCAN_CAP + 1)
        .lean<
          (Lean & {
            date: Date;
            content?: string;
            events?: unknown[];
            notes?: unknown[];
          })[]
        >(),
    );
    return {
      truncated,
      rows: docs.map((log) => {
        const content = log.content?.trim() ?? "";
        return {
          id: String(log._id),
          ref: entityRef("journal-entry", String(log._id)),
          values: {
            date: log.date.toISOString().slice(0, 10),
            content: clip(content),
            words: content ? content.split(/\s+/).length : 0,
            events: log.events?.length ?? 0,
            notes: log.notes?.length ?? 0,
          },
        };
      }),
    };
  },

  spreadsheets: async (filters) => {
    const tags = requiredValues(filters, "tags");
    const { docs, truncated } = capped(
      await Spreadsheet.find(
        where({}, { tags: tags ? { $in: exactly(tags) } : null }),
      )
        .select({
          title: 1,
          description: 1,
          tags: 1,
          sheetCount: 1,
          rowCount: 1,
          lastOpenedAt: 1,
          updatedAt: 1,
        })
        .sort({ updatedAt: -1 })
        .limit(VIEW_SCAN_CAP + 1)
        .lean<
          (Lean & {
            title: string;
            description?: string;
            tags?: string[];
            sheetCount?: number;
            rowCount?: number;
            lastOpenedAt?: Date;
          })[]
        >(),
    );
    return {
      truncated,
      rows: docs.map((sheet) => ({
        id: String(sheet._id),
        ref: entityRef("spreadsheet", String(sheet._id)),
        values: {
          title: sheet.title,
          description: clip(sheet.description),
          tags: sheet.tags ?? [],
          sheets: sheet.sheetCount ?? null,
          rows: sheet.rowCount ?? null,
          opened: iso(sheet.lastOpenedAt),
          updated: iso(sheet.updatedAt),
        },
      })),
    };
  },

  resources: async () => {
    const { docs, truncated } = capped(
      await Resource.find({})
        .select({
          name: 1,
          type: 1,
          url: 1,
          isActive: 1,
          isPublic: 1,
          "agentService.lastStatus": 1,
          "agentService.lastCheckedAt": 1,
        })
        .sort({ updatedAt: -1 })
        .limit(VIEW_SCAN_CAP + 1)
        .lean<
          (Lean & {
            name: string;
            type: string;
            url?: string;
            isActive?: boolean;
            isPublic?: boolean;
            agentService?: {
              lastStatus?: string | null;
              lastCheckedAt?: Date | null;
            };
          })[]
        >(),
    );
    return {
      truncated,
      rows: docs.map((resource) => ({
        id: String(resource._id),
        ref: entityRef("resource", String(resource._id)),
        values: {
          name: resource.name,
          type: resource.type,
          url: resource.url ?? null,
          active: resource.isActive === true,
          public: resource.isPublic === true,
          health: resource.agentService?.lastStatus ?? null,
          checked: iso(resource.agentService?.lastCheckedAt),
        },
      })),
    };
  },

  "work-sessions": async (filters, today) => {
    const jobNames = requiredValues(filters, "job");
    const jobs = await WorkJob.find({})
      .select({ name: 1 })
      .lean<(Lean & { name: string })[]>();
    const jobName = new Map(jobs.map((j) => [String(j._id), j.name]));
    const jobIds = jobNames
      ? jobs
          .filter((j) => jobNames.includes(j.name.toLowerCase()))
          .map((j) => j._id)
      : null;
    const { docs, truncated } = capped(
      await WorkSession.find(
        where(
          {},
          {
            day: dayStringRange(dayWindow(filters, "day", today)),
            jobId: jobIds ? { $in: jobIds } : null,
          },
        ),
      )
        .select({ jobId: 1, start: 1, end: 1, breaks: 1, note: 1, day: 1 })
        .sort({ day: -1, start: -1 })
        .limit(VIEW_SCAN_CAP + 1)
        .lean<
          (Lean & {
            jobId: Types.ObjectId;
            start: Date;
            end?: Date;
            breaks?: { start: Date; end?: Date }[];
            note?: string;
            day: string;
          })[]
        >(),
    );
    const now = Date.now();
    return {
      truncated,
      rows: docs.map((session) => {
        const end = session.end?.getTime() ?? now;
        const breakMs = (session.breaks ?? []).reduce(
          (sum, b) =>
            sum + Math.max(0, (b.end?.getTime() ?? end) - b.start.getTime()),
          0,
        );
        const workedMs = Math.max(0, end - session.start.getTime() - breakMs);
        return {
          id: String(session._id),
          ref: entityRef("work-job", String(session.jobId)),
          values: {
            day: session.day,
            job: jobName.get(String(session.jobId)) ?? null,
            start: iso(session.start),
            end: iso(session.end),
            hours: Math.round(workedMs / 36_000) / 100,
            breakMinutes: Math.round(breakMs / 60_000),
            open: session.end === undefined,
            note: clip(session.note),
          },
        };
      }),
    };
  },

  timetable: async () => {
    const { docs, truncated } = capped(
      await TimetableEntry.find({})
        .select({
          title: 1,
          dayOfWeek: 1,
          startTime: 1,
          endTime: 1,
          place: 1,
          isActive: 1,
        })
        .sort({ dayOfWeek: 1, startTime: 1 })
        .limit(VIEW_SCAN_CAP + 1)
        .lean<
          (Lean & {
            title: string;
            dayOfWeek: number;
            startTime: string;
            endTime: string;
            place?: string;
            isActive?: boolean;
          })[]
        >(),
    );
    const weekdays = VIEW_SOURCES.timetable.fields.weekday?.options ?? [];
    return {
      truncated,
      rows: docs.map((entry) => ({
        id: String(entry._id),
        ref: entityRef("timetable-entry", String(entry._id)),
        values: {
          title: entry.title,
          weekday: weekdays[entry.dayOfWeek] ?? null,
          start: entry.startTime,
          end: entry.endTime,
          place: entry.place ?? null,
          active: entry.isActive !== false,
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
