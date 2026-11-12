import {
  ENTITY_KINDS,
  type EntityKind,
  entityRef,
  parseEntityRef,
  type RecordSummary,
  type RecordsResponse,
} from "@repo/schemas";
import mongoose, { type Types } from "mongoose";
import { AgentTask } from "@/models/AgentTask";
import { Blog } from "@/models/Blog";
import { CalendarEvent } from "@/models/CalendarEvent";
import { Contact } from "@/models/Contact";
import { Course } from "@/models/Course";
import { CourseAssignment } from "@/models/CourseAssignment";
import { Deck } from "@/models/Deck";
import { EmailModel } from "@/models/Email";
import { EmailAccountModel } from "@/models/EmailAccount";
import {
  FinanceAccount,
  FinanceEnvelope,
  FinanceLedgerEntry,
  FinanceRecurringRule,
} from "@/models/Finance";
import { Flashcard } from "@/models/Flashcard";
import { JournalLog } from "@/models/Journal";
import { KanbanBoard } from "@/models/KanbanBoard";
import { KanbanCard } from "@/models/KanbanCard";
import { KanbanColumn } from "@/models/KanbanColumn";
import { LatexProject } from "@/models/LatexProject";
import { MarketPortfolio, MarketWatchlist } from "@/models/Market";
import { Note } from "@/models/Note";
import { Notebook } from "@/models/Notebook";
import { NoteGroup } from "@/models/NoteGroup";
import { Paper } from "@/models/Paper";
import { Person } from "@/models/Person";
import { PersonGroup } from "@/models/PersonGroup";
import { Project } from "@/models/Project";
import { Quiz } from "@/models/Quiz";
import { Resource } from "@/models/Resource";
import { Spreadsheet } from "@/models/Spreadsheet";
import { StudyDocument } from "@/models/StudyDocument";
import TimelineItem from "@/models/TimelineItem";
import { TimetableEntry } from "@/models/TimetableEntry";
import { VoiceNote } from "@/models/VoiceNote";
import { Whiteboard } from "@/models/Whiteboard";
import { WorkJob } from "@/models/WorkHours";
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

function excerpt(text: string | null | undefined, max = 120): string {
  const line = (text ?? "").replace(/\s+/g, " ").trim();
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

const WEEKDAYS = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
];

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
  createdAt?: Date;
  updatedAt?: Date;
}

/** How many documents hold each of `ids` in their `groupIds`. */
async function groupCounts(
  count: (
    pipeline: mongoose.PipelineStage[],
  ) => Promise<{ _id: Types.ObjectId; n: number }[]>,
  ids: Types.ObjectId[],
): Promise<Map<string, number>> {
  if (ids.length === 0) return new Map();
  const counts = await count([
    { $match: { groupIds: { $in: ids } } },
    { $unwind: "$groupIds" },
    { $match: { groupIds: { $in: ids } } },
    { $group: { _id: "$groupIds", n: { $sum: 1 } } },
  ]);
  return new Map(counts.map((c) => [String(c._id), c.n]));
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

  "blog-post": async (match, limit) => {
    const posts = await Blog.find(filterFor(match, "title"))
      .select({
        title: 1,
        excerpt: 1,
        tags: 1,
        timeToRead: 1,
        isActive: 1,
        createdAt: 1,
        updatedAt: 1,
      })
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean<
        (Lean & {
          title: string;
          excerpt?: string;
          tags?: string[];
          timeToRead?: number;
          isActive?: boolean;
        })[]
      >();
    return posts.map((post) =>
      summary("blog-post", String(post._id), {
        title: post.title,
        subtitle: excerpt(post.excerpt),
        fields: fields([
          ["Status", post.isActive ? "published" : "draft"],
          ["Tags", post.tags?.join(", ")],
          ["Read", post.timeToRead ? `${post.timeToRead} min` : null],
          ["Created", day(post.createdAt)],
        ]),
        updatedAt: post.updatedAt?.toISOString(),
      }),
    );
  },

  project: async (match, limit) => {
    const projects = await Project.find(filterFor(match, "title"))
      .select({
        title: 1,
        subtitle: 1,
        tags: 1,
        isActive: 1,
        isFeatured: 1,
        sourceRepository: 1,
        updatedAt: 1,
      })
      .sort({ updatedAt: -1 })
      .limit(limit)
      .lean<
        (Lean & {
          title: string;
          subtitle?: string;
          tags?: string[];
          isActive?: boolean;
          isFeatured?: boolean;
          sourceRepository?: { owner: string; repo: string };
        })[]
      >();
    return projects.map((project) =>
      summary("project", String(project._id), {
        title: project.title,
        subtitle: project.subtitle,
        fields: fields([
          [
            "Status",
            project.isActive
              ? project.isFeatured
                ? "featured"
                : "active"
              : "hidden",
          ],
          ["Tags", project.tags?.join(", ")],
          [
            "Repository",
            project.sourceRepository
              ? `${project.sourceRepository.owner}/${project.sourceRepository.repo}`
              : null,
          ],
        ]),
        updatedAt: project.updatedAt?.toISOString(),
      }),
    );
  },

  "timeline-item": async (match, limit) => {
    const items = await TimelineItem.find(filterFor(match, "title"))
      .select({
        title: 1,
        subtitle: 1,
        category: 1,
        dateFrom: 1,
        dateTo: 1,
        isActive: 1,
        updatedAt: 1,
      })
      .sort({ updatedAt: -1 })
      .limit(limit)
      .lean<
        (Lean & {
          title: string;
          subtitle?: string;
          category?: string;
          dateFrom: string;
          dateTo?: string;
          isActive?: boolean;
        })[]
      >();
    return items.map((item) =>
      summary("timeline-item", String(item._id), {
        title: item.title,
        subtitle: item.subtitle,
        fields: fields([
          ["Category", item.category],
          ["Period", `${item.dateFrom} – ${item.dateTo || "now"}`],
          ["Status", item.isActive ? null : "hidden"],
        ]),
        updatedAt: item.updatedAt?.toISOString(),
      }),
    );
  },

  // Addressed by ticket id, which is what the contacts route takes.
  contact: async (match, limit) => {
    const filter = match.ids
      ? { ticketId: { $in: match.ids } }
      : match.pattern
        ? { $or: [{ name: match.pattern }, { email: match.pattern }] }
        : {};
    const contacts = await Contact.find(filter)
      .select({
        ticketId: 1,
        name: 1,
        email: 1,
        message: 1,
        status: 1,
        emailSent: 1,
        createdAt: 1,
        updatedAt: 1,
      })
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean<
        (Lean & {
          ticketId: string;
          name: string;
          email: string;
          message?: string;
          status?: string;
          emailSent?: boolean;
        })[]
      >();
    return contacts.map((contact) =>
      summary("contact", contact.ticketId, {
        title: contact.name,
        subtitle: excerpt(contact.message),
        fields: fields([
          ["Email", contact.email],
          ["Status", contact.status],
          ["Replied", contact.emailSent ? "yes" : null],
          ["Received", day(contact.createdAt)],
        ]),
        updatedAt: contact.updatedAt?.toISOString(),
      }),
    );
  },

  // Envelope only: bodies live in EmailBody and never reach a summary.
  email: async (match, limit) => {
    const emails = await EmailModel.find(filterFor(match, "subject"))
      .select({ accountId: 1, subject: 1, from: 1, date: 1, seen: 1 })
      .sort({ date: -1 })
      .limit(limit)
      .lean<
        (Lean & {
          accountId: Types.ObjectId;
          subject?: string;
          from?: { name?: string; address: string }[];
          date: Date;
          seen?: boolean;
        })[]
      >();
    const accounts = await EmailAccountModel.find({
      _id: { $in: [...new Set(emails.map((e) => String(e.accountId)))] },
    })
      .select({ displayName: 1, user: 1 })
      .lean<(Lean & { displayName?: string; user: string })[]>();
    const account = new Map(
      accounts.map((a) => [String(a._id), a.displayName || a.user]),
    );
    return emails.map((email) => {
      const sender = email.from?.[0];
      return summary("email", String(email._id), {
        title: email.subject?.trim() || "(no subject)",
        subtitle: sender ? sender.name || sender.address : undefined,
        fields: fields([
          ["Received", email.date.toISOString()],
          ["Account", account.get(String(email.accountId))],
          ["Seen", email.seen ? null : "unread"],
        ]),
        updatedAt: email.date.toISOString(),
      });
    });
  },

  "finance-account": async (match, limit) => {
    const accounts = await FinanceAccount.find(filterFor(match, "displayName"))
      .select({
        displayName: 1,
        institutionName: 1,
        currency: 1,
        provider: 1,
        connectionStatus: 1,
        lastSyncedAt: 1,
        updatedAt: 1,
      })
      .sort({ updatedAt: -1 })
      .limit(limit)
      .lean<
        (Lean & {
          displayName: string;
          institutionName: string;
          currency: string;
          provider: string;
          connectionStatus: string;
          lastSyncedAt?: Date;
        })[]
      >();
    return accounts.map((account) =>
      summary("finance-account", String(account._id), {
        title: account.displayName,
        subtitle: account.institutionName,
        fields: fields([
          ["Currency", account.currency],
          ["Provider", account.provider],
          [
            "Connection",
            account.connectionStatus === "active"
              ? null
              : account.connectionStatus,
          ],
          ["Synced", day(account.lastSyncedAt)],
        ]),
        updatedAt: account.updatedAt?.toISOString(),
      }),
    );
  },

  "finance-entry": async (match, limit) => {
    const entries = await FinanceLedgerEntry.find(
      filterFor(match, "descriptor"),
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
        updatedAt: 1,
      })
      .sort({ effectiveDate: -1, _id: -1 })
      .limit(limit)
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
        })[]
      >();
    const accounts = await FinanceAccount.find({
      _id: { $in: [...new Set(entries.map((e) => String(e.accountId)))] },
    })
      .select({ displayName: 1 })
      .lean<(Lean & { displayName: string })[]>();
    const account = new Map(
      accounts.map((a) => [String(a._id), a.displayName]),
    );
    return entries.map((entry) =>
      summary("finance-entry", String(entry._id), {
        title: excerpt(entry.descriptor, 200) || "Untitled",
        subtitle: account.get(String(entry.accountId)),
        fields: fields([
          ["Amount", formatMinor(entry.amountMinor, entry.currency)],
          ["Date", entry.effectiveDate],
          ["Category", entry.category],
          ["Origin", entry.origin],
          ["State", entry.state],
        ]),
        updatedAt: entry.updatedAt?.toISOString(),
      }),
    );
  },

  "finance-rule": async (match, limit) => {
    const rules = await FinanceRecurringRule.find(filterFor(match, "name"))
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
        updatedAt: 1,
      })
      .sort({ updatedAt: -1 })
      .limit(limit)
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
      >();
    const accounts = await FinanceAccount.find({
      _id: { $in: [...new Set(rules.map((r) => String(r.accountId)))] },
    })
      .select({ displayName: 1 })
      .lean<(Lean & { displayName: string })[]>();
    const account = new Map(
      accounts.map((a) => [String(a._id), a.displayName]),
    );
    return rules.map((rule) =>
      summary("finance-rule", String(rule._id), {
        title: rule.name,
        subtitle: account.get(String(rule.accountId)),
        fields: fields([
          [
            "Amount",
            `${rule.amountKind === "variable" ? "~" : ""}${formatMinor(rule.amountMinor, rule.currency)}`,
          ],
          ["Direction", rule.payout ? "payout" : rule.direction],
          ["Status", rule.status === "active" ? null : rule.status],
          ["Anchor", rule.anchorDate],
          ["Ends", rule.endDate],
        ]),
        updatedAt: rule.updatedAt?.toISOString(),
      }),
    );
  },

  "journal-entry": async (match, limit) => {
    const logs = await JournalLog.find(filterFor(match, "content"))
      .select({ date: 1, content: 1, events: 1, notes: 1 })
      .sort({ date: -1 })
      .limit(limit)
      .lean<
        (Lean & {
          date: Date;
          content?: string;
          events?: unknown[];
          notes?: unknown[];
        })[]
      >();
    return logs.map((log) => {
      const content = log.content?.trim() ?? "";
      return summary("journal-entry", String(log._id), {
        title: day(log.date),
        subtitle: excerpt(content),
        fields: fields([
          ["Words", content ? content.split(/\s+/).length : null],
          ["Events", log.events?.length || null],
          ["Notes", log.notes?.length || null],
        ]),
      });
    });
  },

  spreadsheet: async (match, limit) => {
    const sheets = await Spreadsheet.find(filterFor(match, "title"))
      .select({
        title: 1,
        description: 1,
        tags: 1,
        sheetCount: 1,
        rowCount: 1,
        colCount: 1,
        lastOpenedAt: 1,
        updatedAt: 1,
      })
      .sort({ updatedAt: -1 })
      .limit(limit)
      .lean<
        (Lean & {
          title: string;
          description?: string;
          tags?: string[];
          sheetCount?: number;
          rowCount?: number;
          colCount?: number;
          lastOpenedAt?: Date;
        })[]
      >();
    return sheets.map((sheet) =>
      summary("spreadsheet", String(sheet._id), {
        title: sheet.title,
        subtitle: excerpt(sheet.description),
        fields: fields([
          ["Sheets", sheet.sheetCount],
          [
            "Size",
            sheet.rowCount !== undefined && sheet.colCount !== undefined
              ? `${sheet.rowCount} × ${sheet.colCount}`
              : null,
          ],
          ["Tags", sheet.tags?.join(", ")],
          ["Opened", day(sheet.lastOpenedAt)],
        ]),
        updatedAt: sheet.updatedAt?.toISOString(),
      }),
    );
  },

  resource: async (match, limit) => {
    const resources = await Resource.find(filterFor(match, "name"))
      .select({
        name: 1,
        type: 1,
        url: 1,
        isActive: 1,
        isPublic: 1,
        "agentService.lastStatus": 1,
        "agentService.lastCheckedAt": 1,
        updatedAt: 1,
      })
      .sort({ updatedAt: -1 })
      .limit(limit)
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
      >();
    return resources.map((resource) =>
      summary("resource", String(resource._id), {
        title: resource.name,
        subtitle: resource.type,
        fields: fields([
          ["URL", resource.url],
          ["Health", resource.agentService?.lastStatus],
          ["Checked", day(resource.agentService?.lastCheckedAt)],
          [
            "Status",
            resource.isActive ? (resource.isPublic ? "public" : null) : "off",
          ],
        ]),
        updatedAt: resource.updatedAt?.toISOString(),
      }),
    );
  },

  "person-group": async (match, limit) => {
    const groups = await PersonGroup.find(filterFor(match, "name"))
      .select({ name: 1, description: 1, updatedAt: 1 })
      .sort({ updatedAt: -1 })
      .limit(limit)
      .lean<(Lean & { name: string; description?: string })[]>();
    const members = await groupCounts(
      (pipeline) => Person.aggregate(pipeline),
      groups.map((g) => g._id),
    );
    return groups.map((group) =>
      summary("person-group", String(group._id), {
        title: group.name,
        subtitle: excerpt(group.description),
        fields: fields([["People", members.get(String(group._id)) ?? 0]]),
        updatedAt: group.updatedAt?.toISOString(),
      }),
    );
  },

  "note-group": async (match, limit) => {
    const groups = await NoteGroup.find(filterFor(match, "name"))
      .select({ name: 1, description: 1, kind: 1, updatedAt: 1 })
      .sort({ updatedAt: -1 })
      .limit(limit)
      .lean<(Lean & { name: string; description?: string; kind?: string })[]>();
    const members = await groupCounts(
      (pipeline) => Note.aggregate(pipeline),
      groups.map((g) => g._id),
    );
    return groups.map((group) =>
      summary("note-group", String(group._id), {
        title: group.name,
        subtitle: excerpt(group.description),
        fields: fields([
          ["Notes", members.get(String(group._id)) ?? 0],
          ["Kind", group.kind],
        ]),
        updatedAt: group.updatedAt?.toISOString(),
      }),
    );
  },

  "agent-task": async (match, limit) => {
    const tasks = await AgentTask.find({
      ...filterFor(match, "name"),
      // Section tasks are edited through their block, so they resolve but never surface in search.
      ...(match.ids ? {} : { workspaceSection: { $exists: false } }),
    })
      .select({
        name: 1,
        status: 1,
        schedule: 1,
        runAt: 1,
        llmModel: 1,
        nextRunAt: 1,
        lastRunAt: 1,
        updatedAt: 1,
      })
      .sort({ updatedAt: -1 })
      .limit(limit)
      .lean<
        (Lean & {
          name: string;
          status?: string;
          schedule?: { cron: string; timeZone: string };
          runAt?: Date;
          llmModel?: string;
          nextRunAt?: Date;
          lastRunAt?: Date;
        })[]
      >();
    return tasks.map((task) =>
      summary("agent-task", String(task._id), {
        title: task.name,
        subtitle: task.schedule
          ? `${task.schedule.cron} (${task.schedule.timeZone})`
          : task.runAt
            ? `once ${task.runAt.toISOString()}`
            : "manual",
        fields: fields([
          ["Status", task.status],
          ["Next run", task.nextRunAt?.toISOString()],
          ["Last run", task.lastRunAt?.toISOString()],
          ["Model", task.llmModel],
        ]),
        updatedAt: task.updatedAt?.toISOString(),
      }),
    );
  },

  "course-assignment": async (match, limit) => {
    const works = await CourseAssignment.find(filterFor(match, "title"))
      .select({
        courseId: 1,
        title: 1,
        type: 1,
        status: 1,
        dueAt: 1,
        grade: 1,
        updatedAt: 1,
      })
      .sort({ dueAt: -1 })
      .limit(limit)
      .lean<
        (Lean & {
          courseId: Types.ObjectId;
          title: string;
          type?: string;
          status?: string;
          dueAt?: Date;
          grade?: { score?: number; maxScore?: number; weight?: number };
        })[]
      >();
    const courses = await Course.find({
      _id: { $in: [...new Set(works.map((w) => String(w.courseId)))] },
    })
      .select({ name: 1, code: 1 })
      .lean<(Lean & { name: string; code?: string })[]>();
    const course = new Map(
      courses.map((c) => [String(c._id), c.code || c.name]),
    );
    return works.map((work) => {
      const grade = work.grade;
      return summary("course-assignment", String(work._id), {
        title: work.title,
        subtitle: course.get(String(work.courseId)),
        fields: fields([
          ["Type", work.type],
          ["Status", work.status],
          ["Due", work.dueAt?.toISOString()],
          [
            "Score",
            grade?.score !== undefined
              ? `${grade.score}${grade.maxScore !== undefined ? ` / ${grade.maxScore}` : ""}`
              : null,
          ],
          ["Weight", grade?.weight !== undefined ? `${grade.weight}%` : null],
        ]),
        updatedAt: work.updatedAt?.toISOString(),
      });
    });
  },

  "work-job": async (match, limit) => {
    const jobs = await WorkJob.find(filterFor(match, "name"))
      .select({
        name: 1,
        hourlyRateMinor: 1,
        currency: 1,
        expectedWeeklyHours: 1,
        timezone: 1,
        status: 1,
        updatedAt: 1,
      })
      .sort({ updatedAt: -1 })
      .limit(limit)
      .lean<
        (Lean & {
          name: string;
          hourlyRateMinor: number;
          currency: string;
          expectedWeeklyHours?: number;
          timezone: string;
          status: string;
        })[]
      >();
    return jobs.map((job) =>
      summary("work-job", String(job._id), {
        title: job.name,
        fields: fields([
          ["Rate", `${formatMinor(job.hourlyRateMinor, job.currency)} / h`],
          [
            "Weekly",
            job.expectedWeeklyHours ? `${job.expectedWeeklyHours} h` : null,
          ],
          ["Time zone", job.timezone],
          ["Status", job.status === "active" ? null : job.status],
        ]),
        updatedAt: job.updatedAt?.toISOString(),
      }),
    );
  },

  "timetable-entry": async (match, limit) => {
    const entries = await TimetableEntry.find(filterFor(match, "title"))
      .select({
        title: 1,
        dayOfWeek: 1,
        startTime: 1,
        endTime: 1,
        place: 1,
        isActive: 1,
        updatedAt: 1,
      })
      .sort({ dayOfWeek: 1, startTime: 1 })
      .limit(limit)
      .lean<
        (Lean & {
          title: string;
          dayOfWeek: number;
          startTime: string;
          endTime: string;
          place?: string;
          isActive?: boolean;
        })[]
      >();
    return entries.map((entry) =>
      summary("timetable-entry", String(entry._id), {
        title: entry.title,
        subtitle:
          `${WEEKDAYS[entry.dayOfWeek] ?? ""} ${entry.startTime}–${entry.endTime}`.trim(),
        fields: fields([
          ["Place", entry.place],
          ["Status", entry.isActive === false ? "inactive" : null],
        ]),
        updatedAt: entry.updatedAt?.toISOString(),
      }),
    );
  },

  portfolio: async (match, limit) => {
    const portfolios = await MarketPortfolio.find(filterFor(match, "name"))
      .select({
        name: 1,
        baseCurrency: 1,
        initialCash: 1,
        benchmark: 1,
        allowShorts: 1,
        inceptionDate: 1,
        updatedAt: 1,
      })
      .sort({ updatedAt: -1 })
      .limit(limit)
      .lean<
        (Lean & {
          name: string;
          baseCurrency?: string;
          initialCash: number;
          benchmark?: string | null;
          allowShorts?: boolean;
          inceptionDate: string;
        })[]
      >();
    return portfolios.map((portfolio) =>
      summary("portfolio", String(portfolio._id), {
        title: portfolio.name,
        fields: fields([
          [
            "Initial cash",
            new Intl.NumberFormat("en", {
              style: "currency",
              currency: portfolio.baseCurrency ?? "USD",
            }).format(portfolio.initialCash),
          ],
          ["Inception", portfolio.inceptionDate],
          ["Benchmark", portfolio.benchmark],
          ["Shorts", portfolio.allowShorts ? "allowed" : null],
        ]),
        updatedAt: portfolio.updatedAt?.toISOString(),
      }),
    );
  },

  watchlist: async (match, limit) => {
    const lists = await MarketWatchlist.find(filterFor(match, "name"))
      .select({ name: 1, tickers: 1, updatedAt: 1 })
      .sort({ updatedAt: -1 })
      .limit(limit)
      .lean<(Lean & { name: string; tickers?: string[] })[]>();
    return lists.map((list) => {
      const tickers = list.tickers ?? [];
      return summary("watchlist", String(list._id), {
        title: list.name,
        fields: fields([
          ["Symbols", tickers.length],
          [
            "Tickers",
            tickers.length > 8
              ? `${tickers.slice(0, 8).join(", ")}…`
              : tickers.join(", "),
          ],
        ]),
        updatedAt: list.updatedAt?.toISOString(),
      });
    });
  },

  notebook: async (match, limit) => {
    const notebooks = await Notebook.find({
      ...filterFor(match, "title"),
      ...(match.ids ? {} : { archivedAt: { $exists: false } }),
    })
      .select({ title: 1, icon: 1, courseId: 1, sources: 1, updatedAt: 1 })
      .sort({ updatedAt: -1 })
      .limit(limit)
      .lean<
        (Lean & {
          title: string;
          icon?: string;
          courseId?: Types.ObjectId;
          sources?: unknown[];
        })[]
      >();
    const courses = await Course.find({
      _id: { $in: notebooks.flatMap((n) => (n.courseId ? [n.courseId] : [])) },
    })
      .select({ name: 1 })
      .lean<{ _id: Types.ObjectId; name: string }[]>();
    const courseName = new Map(courses.map((c) => [String(c._id), c.name]));
    return notebooks.map((notebook) =>
      summary("notebook", String(notebook._id), {
        title: notebook.title,
        icon: notebook.icon,
        subtitle: notebook.courseId
          ? courseName.get(String(notebook.courseId))
          : undefined,
        fields: fields([
          ["Sources", notebook.sources?.length],
          ["Updated", day(notebook.updatedAt)],
        ]),
        updatedAt: notebook.updatedAt?.toISOString(),
      }),
    );
  },

  deck: async (match, limit) => {
    const decks = await Deck.find(filterFor(match, "title"))
      .select({ title: 1, description: 1, notebookId: 1, updatedAt: 1 })
      .sort({ updatedAt: -1 })
      .limit(limit)
      .lean<
        (Lean & {
          title: string;
          description?: string;
          notebookId: Types.ObjectId;
        })[]
      >();
    const notebooks = await Notebook.find({
      _id: { $in: decks.map((d) => d.notebookId) },
    })
      .select({ title: 1 })
      .lean<{ _id: Types.ObjectId; title: string }[]>();
    const notebookTitle = new Map(
      notebooks.map((n) => [String(n._id), n.title]),
    );
    const cardCounts = await Flashcard.aggregate<{
      _id: Types.ObjectId;
      n: number;
    }>([
      { $match: { deckId: { $in: decks.map((d) => d._id) } } },
      { $group: { _id: "$deckId", n: { $sum: 1 } } },
    ]);
    const cards = new Map(cardCounts.map((c) => [String(c._id), c.n]));
    return decks.map((deck) =>
      summary("deck", String(deck._id), {
        title: deck.title,
        subtitle: notebookTitle.get(String(deck.notebookId)),
        fields: fields([
          ["Cards", cards.get(String(deck._id)) ?? 0],
          ["Updated", day(deck.updatedAt)],
        ]),
        updatedAt: deck.updatedAt?.toISOString(),
      }),
    );
  },

  quiz: async (match, limit) => {
    const quizzes = await Quiz.find(filterFor(match, "title"))
      .select({
        title: 1,
        notebookId: 1,
        questionIds: 1,
        attemptCount: 1,
        bestScore: 1,
        updatedAt: 1,
      })
      .sort({ updatedAt: -1 })
      .limit(limit)
      .lean<
        (Lean & {
          title: string;
          notebookId: Types.ObjectId;
          questionIds?: unknown[];
          attemptCount?: number;
          bestScore?: number;
        })[]
      >();
    const notebooks = await Notebook.find({
      _id: { $in: quizzes.map((q) => q.notebookId) },
    })
      .select({ title: 1 })
      .lean<{ _id: Types.ObjectId; title: string }[]>();
    const notebookTitle = new Map(
      notebooks.map((n) => [String(n._id), n.title]),
    );
    return quizzes.map((quiz) =>
      summary("quiz", String(quiz._id), {
        title: quiz.title,
        subtitle: notebookTitle.get(String(quiz.notebookId)),
        fields: fields([
          ["Questions", quiz.questionIds?.length],
          ["Attempts", quiz.attemptCount],
          [
            "Best",
            quiz.bestScore === undefined
              ? undefined
              : `${Math.round(quiz.bestScore * 100)}%`,
          ],
        ]),
        updatedAt: quiz.updatedAt?.toISOString(),
      }),
    );
  },

  "study-document": async (match, limit) => {
    const documents = await StudyDocument.find(filterFor(match, "title"))
      .select({ title: 1, pageCount: 1, extraction: 1, updatedAt: 1 })
      .sort({ updatedAt: -1 })
      .limit(limit)
      .lean<
        (Lean & { title: string; pageCount?: number; extraction?: string })[]
      >();
    return documents.map((document) =>
      summary("study-document", String(document._id), {
        title: document.title,
        fields: fields([
          ["Pages", document.pageCount],
          ["Extraction", document.extraction],
        ]),
        updatedAt: document.updatedAt?.toISOString(),
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
