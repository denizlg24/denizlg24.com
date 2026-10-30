import {
  ENTITY_KINDS,
  type EntityKind,
  entityRef,
  parseEntityRef,
  type RecordSummary,
  type RecordsResponse,
} from "@repo/schemas";
import mongoose, { type Types } from "mongoose";
import { CalendarEvent } from "@/models/CalendarEvent";
import { Course } from "@/models/Course";
import { FinanceEnvelope } from "@/models/Finance";
import { KanbanBoard } from "@/models/KanbanBoard";
import { KanbanCard } from "@/models/KanbanCard";
import { KanbanColumn } from "@/models/KanbanColumn";
import { LatexProject } from "@/models/LatexProject";
import { Note } from "@/models/Note";
import { Paper } from "@/models/Paper";
import { Person } from "@/models/Person";
import { VoiceNote } from "@/models/VoiceNote";
import { Whiteboard } from "@/models/Whiteboard";
import { WorkspacePageModel } from "@/models/WorkspacePage";

/*
 * What a record embed, an entity mention and the record picker show: one
 * resolver per entity kind, reading only the fields a summary needs. A
 * record that is gone (or trashed, for pages) is reported missing, never an
 * error. Adding a kind is one entry here and one in the admin registry
 * (`packages/admin/src/workspace/records.tsx`), which owns routes and the
 * full-mode component.
 */

type Match = { ids?: string[]; pattern?: RegExp };
type Find = (match: Match, limit: number) => Promise<RecordSummary[]>;

const SEARCH_PER_KIND = 6;

function day(value: Date | string | null | undefined): string {
  if (!value) return "";
  const date = typeof value === "string" ? new Date(value) : value;
  return Number.isNaN(date.getTime()) ? "" : date.toISOString().slice(0, 10);
}

export function formatMinor(amountMinor: number, currency: string): string {
  const format = new Intl.NumberFormat("en", { style: "currency", currency });
  const digits = format.resolvedOptions().maximumFractionDigits ?? 2;
  return format.format(amountMinor / 10 ** digits);
}

function fields(
  pairs: [label: string, value: string | number | null | undefined][],
): RecordSummary["fields"] {
  return pairs
    .filter(
      (pair): pair is [string, string | number] =>
        pair[1] !== null && pair[1] !== undefined && pair[1] !== "",
    )
    .slice(0, 6)
    .map(([label, value]) => ({ label, value: String(value) }));
}

function summary(
  kind: EntityKind,
  id: string,
  rest: Omit<RecordSummary, "ref" | "kind" | "id">,
): RecordSummary {
  return { ref: entityRef(kind, id), kind, id, ...rest };
}

function objectIds(ids: string[] | undefined): Types.ObjectId[] | undefined {
  return ids
    ?.filter((id) => mongoose.isValidObjectId(id))
    .map((id) => new mongoose.Types.ObjectId(id));
}

/** `{ _id: { $in } }` for an id lookup, `{ [key]: pattern }` for a search. */
function filterFor(match: Match, titleKey: string) {
  const ids = objectIds(match.ids);
  if (ids) return { _id: { $in: ids } };
  return match.pattern ? { [titleKey]: match.pattern } : {};
}

interface Lean {
  _id: Types.ObjectId;
  updatedAt?: Date;
}

const RESOLVERS: Record<EntityKind, Find> = {
  page: async (match, limit) => {
    const filter = match.ids
      ? { _id: { $in: match.ids } }
      : match.pattern
        ? { title: match.pattern }
        : {};
    const pages = await WorkspacePageModel.find({
      ...filter,
      // A template resolves where it is embedded, but is never a search hit.
      ...(match.ids ? {} : { template: { $ne: true } }),
      deletedAt: null,
      purgedAt: null,
    })
      .select({ title: 1, icon: 1, updatedAt: 1 })
      .sort({ updatedAt: -1 })
      .limit(limit)
      .lean<
        { _id: string; title: string; icon: string | null; updatedAt: string }[]
      >();
    return pages.map((page) =>
      summary("page", page._id, {
        title: page.title.trim() || "Untitled",
        icon: page.icon,
        fields: fields([["Updated", day(page.updatedAt)]]),
        updatedAt: page.updatedAt,
      }),
    );
  },

  note: async (match, limit) => {
    const notes = await Note.find(filterFor(match, "title"))
      .select({
        title: 1,
        tags: 1,
        class: 1,
        url: 1,
        siteName: 1,
        status: 1,
        updatedAt: 1,
      })
      .sort({ updatedAt: -1 })
      .limit(limit)
      .lean<
        (Lean & {
          title: string;
          tags?: string[];
          class?: string;
          url?: string;
          siteName?: string;
          status?: string;
        })[]
      >();
    return notes.map((note) =>
      summary("note", String(note._id), {
        title: note.title,
        subtitle: note.siteName ?? note.class,
        fields: fields([
          ["Tags", note.tags?.join(", ")],
          ["Status", note.status === "archived" ? "archived" : null],
          ["Updated", day(note.updatedAt)],
        ]),
        updatedAt: note.updatedAt?.toISOString(),
      }),
    );
  },

  "kanban-board": async (match, limit) => {
    const boards = await KanbanBoard.find(filterFor(match, "title"))
      .select({ title: 1, description: 1, isArchived: 1, updatedAt: 1 })
      .sort({ updatedAt: -1 })
      .limit(limit)
      .lean<
        (Lean & { title: string; description?: string; isArchived?: boolean })[]
      >();
    const counts = await KanbanCard.aggregate<{
      _id: Types.ObjectId;
      n: number;
    }>([
      {
        $match: {
          boardId: { $in: boards.map((b) => b._id) },
          isArchived: { $ne: true },
        },
      },
      { $group: { _id: "$boardId", n: { $sum: 1 } } },
    ]);
    const cardCount = new Map(counts.map((c) => [String(c._id), c.n]));
    return boards.map((board) =>
      summary("kanban-board", String(board._id), {
        title: board.title,
        subtitle: board.description,
        fields: fields([
          ["Cards", cardCount.get(String(board._id)) ?? 0],
          ["Status", board.isArchived ? "archived" : null],
        ]),
        updatedAt: board.updatedAt?.toISOString(),
      }),
    );
  },

  "kanban-card": async (match, limit) => {
    const cards = await KanbanCard.find(filterFor(match, "title"))
      .select({
        title: 1,
        boardId: 1,
        columnId: 1,
        priority: 1,
        labels: 1,
        dueDate: 1,
        isArchived: 1,
        updatedAt: 1,
      })
      .sort({ updatedAt: -1 })
      .limit(limit)
      .lean<
        (Lean & {
          title: string;
          boardId: Types.ObjectId;
          columnId: Types.ObjectId;
          priority?: string;
          labels?: string[];
          dueDate?: Date;
          isArchived?: boolean;
        })[]
      >();
    const [boards, columns] = await Promise.all([
      KanbanBoard.find({ _id: { $in: cards.map((c) => c.boardId) } })
        .select({ title: 1 })
        .lean<(Lean & { title: string })[]>(),
      KanbanColumn.find({ _id: { $in: cards.map((c) => c.columnId) } })
        .select({ title: 1, isDoneColumn: 1 })
        .lean<(Lean & { title: string; isDoneColumn?: boolean })[]>(),
    ]);
    const boardTitle = new Map(boards.map((b) => [String(b._id), b.title]));
    const column = new Map(columns.map((c) => [String(c._id), c]));
    return cards.map((card) => {
      const col = column.get(String(card.columnId));
      return summary("kanban-card", String(card._id), {
        title: card.title,
        subtitle: boardTitle.get(String(card.boardId)),
        fields: fields([
          [
            "Column",
            col ? `${col.title}${col.isDoneColumn ? " ✓" : ""}` : null,
          ],
          ["Due", day(card.dueDate)],
          [
            "Priority",
            card.priority && card.priority !== "none" ? card.priority : null,
          ],
          ["Labels", card.labels?.join(", ")],
          ["Status", card.isArchived ? "archived" : null],
        ]),
        updatedAt: card.updatedAt?.toISOString(),
      });
    });
  },

  whiteboard: async (match, limit) => {
    const boards = await Whiteboard.find(filterFor(match, "name"))
      .select({ name: 1, updatedAt: 1 })
      .sort({ updatedAt: -1 })
      .limit(limit)
      .lean<(Lean & { name: string })[]>();
    return boards.map((board) =>
      summary("whiteboard", String(board._id), {
        title: board.name,
        fields: fields([["Updated", day(board.updatedAt)]]),
        updatedAt: board.updatedAt?.toISOString(),
      }),
    );
  },

  person: async (match, limit) => {
    const people = await Person.find(filterFor(match, "name"))
      .select({
        name: 1,
        birthday: 1,
        email: 1,
        phone: 1,
        placeMet: 1,
        updatedAt: 1,
      })
      .sort({ updatedAt: -1 })
      .limit(limit)
      .lean<
        (Lean & {
          name: string;
          birthday?: {
            month: number;
            day: number;
            year?: number | null;
          } | null;
          email?: string;
          phone?: string;
          placeMet?: string;
        })[]
      >();
    return people.map((person) => {
      const b = person.birthday;
      const birthday = b
        ? `${b.year ? `${b.year}-` : ""}${String(b.month).padStart(2, "0")}-${String(b.day).padStart(2, "0")}`
        : null;
      return summary("person", String(person._id), {
        title: person.name,
        fields: fields([
          ["Birthday", birthday],
          ["Email", person.email],
          ["Phone", person.phone],
          ["Met at", person.placeMet],
        ]),
        updatedAt: person.updatedAt?.toISOString(),
      });
    });
  },

  course: async (match, limit) => {
    const courses = await Course.find(filterFor(match, "name"))
      .select({
        name: 1,
        code: 1,
        semester: 1,
        status: 1,
        instructorName: 1,
        location: 1,
        updatedAt: 1,
      })
      .sort({ updatedAt: -1 })
      .limit(limit)
      .lean<
        (Lean & {
          name: string;
          code?: string;
          semester?: string;
          status?: string;
          instructorName?: string;
          location?: string;
        })[]
      >();
    return courses.map((course) =>
      summary("course", String(course._id), {
        title: course.name,
        subtitle: [course.code, course.semester].filter(Boolean).join(" · "),
        fields: fields([
          ["Instructor", course.instructorName],
          ["Location", course.location],
          ["Status", course.status === "archived" ? "archived" : null],
        ]),
        updatedAt: course.updatedAt?.toISOString(),
      }),
    );
  },

  envelope: async (match, limit) => {
    const envelopes = await FinanceEnvelope.find(filterFor(match, "name"))
      .select({
        name: 1,
        kind: 1,
        limitMinor: 1,
        currency: 1,
        period: 1,
        status: 1,
        updatedAt: 1,
      })
      .sort({ updatedAt: -1 })
      .limit(limit)
      .lean<
        (Lean & {
          name: string;
          kind: string;
          limitMinor: number;
          currency: string;
          period?: string;
          status?: string;
        })[]
      >();
    return envelopes.map((envelope) =>
      summary("envelope", String(envelope._id), {
        title: envelope.name,
        fields: fields([
          [
            "Limit",
            `${formatMinor(envelope.limitMinor, envelope.currency)}${envelope.period ? ` / ${envelope.period}` : ""}`,
          ],
          ["Kind", envelope.kind],
          ["Status", envelope.status],
        ]),
        updatedAt: envelope.updatedAt?.toISOString(),
      }),
    );
  },

  paper: async (match, limit) => {
    const papers = await Paper.find(filterFor(match, "title"))
      .select({
        title: 1,
        authors: 1,
        year: 1,
        type: 1,
        readingStatus: 1,
        venue: 1,
        updatedAt: 1,
      })
      .sort({ updatedAt: -1 })
      .limit(limit)
      .lean<
        (Lean & {
          title: string;
          authors?: { family?: string; given?: string; literal?: string }[];
          year?: number;
          type?: string;
          readingStatus?: string;
          venue?: string;
        })[]
      >();
    return papers.map((paper) => {
      const authors = (paper.authors ?? [])
        .map((a) => a.literal ?? a.family ?? a.given ?? "")
        .filter(Boolean);
      const byline =
        authors.length > 3
          ? `${authors.slice(0, 3).join(", ")} et al.`
          : authors.join(", ");
      return summary("paper", String(paper._id), {
        title: paper.title,
        subtitle: [byline, paper.year].filter(Boolean).join(" · "),
        fields: fields([
          ["Reading", paper.readingStatus],
          ["Type", paper.type],
          ["Venue", paper.venue],
        ]),
        updatedAt: paper.updatedAt?.toISOString(),
      });
    });
  },

  "voice-note": async (match, limit) => {
    const notes = await VoiceNote.find(filterFor(match, "title"))
      .select({
        title: 1,
        recordedAt: 1,
        durationMs: 1,
        tags: 1,
        "transcription.status": 1,
        createdAt: 1,
        updatedAt: 1,
      })
      .sort({ updatedAt: -1 })
      .limit(limit)
      .lean<
        (Lean & {
          title: string;
          recordedAt?: Date;
          createdAt?: Date;
          durationMs?: number;
          tags?: string[];
          transcription?: { status?: string };
        })[]
      >();
    return notes.map((note) =>
      summary("voice-note", String(note._id), {
        title: note.title,
        fields: fields([
          ["Recorded", day(note.recordedAt ?? note.createdAt)],
          [
            "Length",
            note.durationMs
              ? `${Math.round(note.durationMs / 60_000)} min`
              : null,
          ],
          ["Tags", note.tags?.join(", ")],
          ["Transcript", note.transcription?.status],
        ]),
        updatedAt: note.updatedAt?.toISOString(),
      }),
    );
  },

  "latex-project": async (match, limit) => {
    const projects = await LatexProject.find(filterFor(match, "name"))
      .select({ name: 1, compileStatus: 1, archivedAt: 1, updatedAt: 1 })
      .sort({ updatedAt: -1 })
      .limit(limit)
      .lean<
        (Lean & {
          name: string;
          compileStatus?: string;
          archivedAt?: Date | null;
        })[]
      >();
    return projects.map((project) =>
      summary("latex-project", String(project._id), {
        title: project.name,
        fields: fields([
          ["Compile", project.compileStatus],
          ["Status", project.archivedAt ? "archived" : null],
          ["Updated", day(project.updatedAt)],
        ]),
        updatedAt: project.updatedAt?.toISOString(),
      }),
    );
  },

  "calendar-event": async (match, limit) => {
    const events = await CalendarEvent.find({
      ...filterFor(match, "title"),
      "source.isSuppressed": { $ne: true },
    })
      .select({
        title: 1,
        date: 1,
        calendarDate: 1,
        isAllDay: 1,
        place: 1,
        kind: 1,
        status: 1,
      })
      .sort({ date: -1 })
      .limit(limit)
      .lean<
        (Lean & {
          title: string;
          date: Date;
          calendarDate: string;
          isAllDay?: boolean;
          place?: string;
          kind?: string;
          status?: string;
        })[]
      >();
    return events.map((event) =>
      summary("calendar-event", String(event._id), {
        title: event.title,
        subtitle: event.calendarDate,
        fields: fields([
          [
            "Date",
            event.isAllDay ? event.calendarDate : event.date.toISOString(),
          ],
          ["Place", event.place],
          ["Kind", event.kind],
          ["Status", event.status === "scheduled" ? null : event.status],
        ]),
      }),
    );
  },
};

/** Summaries for `refs`, in their order; refs that point at nothing come back as missing. */
export async function resolveRecords(
  refs: readonly string[],
): Promise<RecordsResponse> {
  const byKind = new Map<EntityKind, string[]>();
  const missing: string[] = [];
  for (const ref of refs) {
    const parsed = parseEntityRef(ref);
    if (!parsed) {
      missing.push(ref);
      continue;
    }
    byKind.set(parsed.kind, [...(byKind.get(parsed.kind) ?? []), parsed.id]);
  }
  const found = new Map<string, RecordSummary>();
  await Promise.all(
    [...byKind].map(async ([kind, ids]) => {
      for (const record of await RESOLVERS[kind]({ ids }, ids.length)) {
        found.set(record.ref, record);
      }
    }),
  );
  const records: RecordSummary[] = [];
  for (const ref of new Set(refs)) {
    const record = found.get(ref);
    if (record) records.push(record);
    else if (parseEntityRef(ref)) missing.push(ref);
  }
  return { records, missing };
}

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Records whose title contains `query`, a few per kind; the most recently changed when it is empty. */
export async function searchRecords(
  query: string,
  kinds: readonly EntityKind[] = ENTITY_KINDS,
): Promise<RecordSummary[]> {
  const q = query.trim().slice(0, 100);
  const pattern = q ? new RegExp(escapeRegex(q), "i") : undefined;
  const results = await Promise.all(
    kinds.map((kind) => RESOLVERS[kind]({ pattern }, SEARCH_PER_KIND)),
  );
  return results.flat();
}
