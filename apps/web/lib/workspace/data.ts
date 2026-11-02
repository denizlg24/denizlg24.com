import {
  type DataCollection,
  type DataFilter,
  type DataQuery,
  type DataQueryResult,
  dataQuerySchema,
} from "@repo/schemas";
import { type Collection, ObjectId } from "mongodb";
import { AgentTask } from "@/models/AgentTask";
import { Blog } from "@/models/Blog";
import { CalendarEvent } from "@/models/CalendarEvent";
import { Contact } from "@/models/Contact";
import { Course } from "@/models/Course";
import { CourseAssignment } from "@/models/CourseAssignment";
import { EmailModel } from "@/models/Email";
import {
  FinanceAccount,
  FinanceEnvelope,
  FinanceLedgerEntry,
  FinanceRecurringRule,
} from "@/models/Finance";
import { JournalLog } from "@/models/Journal";
import { KanbanBoard } from "@/models/KanbanBoard";
import { KanbanCard } from "@/models/KanbanCard";
import { KanbanColumn } from "@/models/KanbanColumn";
import { MarketPortfolio, MarketWatchlist } from "@/models/Market";
import { Note } from "@/models/Note";
import { NoteGroup } from "@/models/NoteGroup";
import { Paper } from "@/models/Paper";
import { Person } from "@/models/Person";
import { PersonGroup } from "@/models/PersonGroup";
import { Project } from "@/models/Project";
import { Resource } from "@/models/Resource";
import { Spreadsheet } from "@/models/Spreadsheet";
import TimelineItem from "@/models/TimelineItem";
import { TimetableEntry } from "@/models/TimetableEntry";
import { VoiceNote } from "@/models/VoiceNote";
import { Whiteboard } from "@/models/Whiteboard";
import { WorkJob } from "@/models/WorkHours";
import { WorkspaceError } from "./service";

/*
 * Raw reads of owner-facing collections for custom components. Three lines
 * hold: only collections named here, only the typed filter operators (a
 * field path cannot start with `$`, a value is a scalar), and no field whose
 * name looks like a credential ever leaves, at any depth. Reads go through
 * the driver, so nothing is cast: see `forms` for ids. Bodies that are
 * large and private by nature (email bodies) live in collections not listed.
 */

const COLLECTIONS: Record<DataCollection, () => Collection> = {
  "agent-tasks": () => AgentTask.collection,
  "blog-posts": () => Blog.collection,
  "calendar-events": () => CalendarEvent.collection,
  contacts: () => Contact.collection,
  "course-assignments": () => CourseAssignment.collection,
  courses: () => Course.collection,
  emails: () => EmailModel.collection,
  "finance-accounts": () => FinanceAccount.collection,
  "finance-entries": () => FinanceLedgerEntry.collection,
  "finance-envelopes": () => FinanceEnvelope.collection,
  "finance-rules": () => FinanceRecurringRule.collection,
  journal: () => JournalLog.collection,
  "kanban-boards": () => KanbanBoard.collection,
  "kanban-cards": () => KanbanCard.collection,
  "kanban-columns": () => KanbanColumn.collection,
  "note-groups": () => NoteGroup.collection,
  notes: () => Note.collection,
  papers: () => Paper.collection,
  people: () => Person.collection,
  "person-groups": () => PersonGroup.collection,
  portfolios: () => MarketPortfolio.collection,
  projects: () => Project.collection,
  resources: () => Resource.collection,
  spreadsheets: () => Spreadsheet.collection,
  timeline: () => TimelineItem.collection,
  timetable: () => TimetableEntry.collection,
  "voice-notes": () => VoiceNote.collection,
  watchlists: () => MarketWatchlist.collection,
  whiteboards: () => Whiteboard.collection,
  "work-jobs": () => WorkJob.collection,
};

/** Field names that read as credentials or ciphertext are dropped wherever they appear. */
const SECRET_FIELD =
  /(secret|password|passwd|token|cipher|encrypt|credential|apikey|api_key|private|session|signature|hmac|salt|^iv$|^tag$|^auth|totp|otp)/i;

function isSecretPath(path: string): boolean {
  return path.split(".").some((part) => SECRET_FIELD.test(part));
}

type Scalar = string | number | boolean | null | Date | ObjectId;

const OBJECT_ID = /^[a-f0-9]{24}$/;

function toValue(value: string | number | boolean | null): Scalar {
  if (typeof value === "string" && value.startsWith("date:")) {
    const date = new Date(value.slice(5));
    if (!Number.isNaN(date.getTime())) return date;
  }
  return value;
}

/** The driver does no casting: an id-looking string matches either form. */
function forms(value: Scalar): Scalar[] {
  return typeof value === "string" && OBJECT_ID.test(value)
    ? [value, new ObjectId(value)]
    : [value];
}

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function condition(filter: DataFilter): Record<string, unknown> {
  const raw = filter.value;
  const one = Array.isArray(raw) ? raw[0] : raw;
  const value = one === undefined ? null : toValue(one);
  const list = (Array.isArray(raw) ? raw : raw === undefined ? [] : [raw]).map(
    toValue,
  );
  switch (filter.op) {
    case "eq":
      return { $in: forms(value) };
    case "ne":
      return { $nin: forms(value) };
    case "gt":
      return { $gt: value };
    case "gte":
      return { $gte: value };
    case "lt":
      return { $lt: value };
    case "lte":
      return { $lte: value };
    case "in":
      return { $in: list.flatMap(forms) };
    case "nin":
      return { $nin: list.flatMap(forms) };
    case "exists":
      return { $exists: value !== false };
    case "contains":
      return {
        $regex: escapeRegex(String(one ?? "")).slice(0, 200),
        $options: "i",
      };
  }
}

/** Plain JSON: ids and dates as strings, secret-looking keys gone. */
function clean(value: unknown, depth: number): unknown {
  if (depth > 6) return null;
  if (value instanceof Date) return value.toISOString();
  if (value instanceof ObjectId) return value.toHexString();
  if (Array.isArray(value)) {
    return value.slice(0, 200).map((inner) => clean(inner, depth + 1));
  }
  if (value && typeof value === "object") {
    return cleanRecord(Object.entries(value), depth);
  }
  if (typeof value === "string" && value.length > 4000) {
    return `${value.slice(0, 4000)}…`;
  }
  return value;
}

function cleanRecord(
  entries: [string, unknown][],
  depth: number,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, inner] of entries) {
    if (key === "__v" || SECRET_FIELD.test(key)) continue;
    out[key === "_id" ? "id" : key] = clean(inner, depth + 1);
  }
  return out;
}

export async function queryData(input: DataQuery): Promise<DataQueryResult> {
  const query = dataQuerySchema.parse(input);
  const collection = COLLECTIONS[query.collection]();
  const paths = [
    ...query.filter.map((f) => f.field),
    ...(query.sort ? [query.sort.field] : []),
    ...(query.fields ?? []),
  ];
  const secret = paths.find(isSecretPath);
  if (secret) {
    throw new WorkspaceError(
      400,
      "SECRET_FIELD",
      `Field ${secret} is not readable`,
    );
  }
  const match: Record<string, unknown> = {};
  for (const filter of query.filter) {
    const field = filter.field === "id" ? "_id" : filter.field;
    const existing = match[field];
    match[field] =
      existing && typeof existing === "object"
        ? { ...existing, ...condition(filter) }
        : condition(filter);
  }
  const projection = query.fields
    ? Object.fromEntries(query.fields.map((f) => [f === "id" ? "_id" : f, 1]))
    : undefined;
  const sort = query.sort
    ? {
        [query.sort.field === "id" ? "_id" : query.sort.field]:
          query.sort.dir === "asc" ? (1 as const) : (-1 as const),
      }
    : { _id: -1 as const };
  try {
    const [docs, total] = await Promise.all([
      collection
        .find(match, { projection, sort, limit: query.limit })
        .toArray(),
      collection.countDocuments(match),
    ]);
    return {
      collection: query.collection,
      rows: docs.map((doc) => cleanRecord(Object.entries(doc), 0)),
      total,
    };
  } catch (error) {
    if (error instanceof Error && error.name === "MongoServerError") {
      throw new WorkspaceError(400, "INVALID_FILTER", error.message);
    }
    throw error;
  }
}
