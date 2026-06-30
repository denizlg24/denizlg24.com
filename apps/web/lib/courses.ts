import type {
  CourseStatus,
  ICourse as CourseWire,
  ICourseCalendarSummary,
  ICourseDeadline,
  ICourseDetail,
  ICourseEmailSummary,
  ICourseKanbanBoardSummary,
  ICourseKanbanCardSummary,
  ICourseListItem,
  ICourseNoteSummary,
  ICourseOptions,
  ICoursePersonSummary,
  ICourseResourceSummary,
  ICourseStats,
  ICourseTimetableSummary,
  TriageCategory,
} from "@repo/schemas";
import mongoose from "mongoose";
import { CalendarEvent } from "@/models/CalendarEvent";
import { Course } from "@/models/Course";
import { EmailModel } from "@/models/Email";
import { EmailTriageModel } from "@/models/EmailTriage";
import { KanbanBoard } from "@/models/KanbanBoard";
import { KanbanCard } from "@/models/KanbanCard";
import { Note } from "@/models/Note";
import { Person } from "@/models/Person";
import { Resource } from "@/models/Resource";
import { TimetableEntry } from "@/models/TimetableEntry";
import { connectDB } from "./mongodb";

const TRIAGE_CATEGORIES: readonly TriageCategory[] = [
  "spam",
  "newsletter",
  "promo",
  "purchases",
  "fyi",
  "action-needed",
  "scheduled",
];

const LINK_FIELDS = [
  "timetableEntryIds",
  "calendarEventIds",
  "kanbanBoardIds",
  "noteIds",
  "personIds",
  "resourceIds",
] as const;
export type CourseLinkField = (typeof LINK_FIELDS)[number];

export interface CourseMatchCandidate {
  _id: string;
  name: string;
  code?: string;
  instructorName?: string;
  boardIds: string[];
  openDeadlines: { _id: string; title: string; dueAt: string }[];
  upcomingEvents: { _id: string; title: string; date: string }[];
}

type RawRecord = Record<string, unknown>;
type LeanFindModel = {
  find(filter: Record<string, unknown>): {
    lean<T>(): Promise<T>;
  };
};

type CourseMutationInput = Partial<
  Omit<CourseWire, "_id" | "createdAt" | "updatedAt">
>;

const ID_ARRAY_FIELDS = [
  "timetableEntryIds",
  "calendarEventIds",
  "kanbanBoardIds",
  "noteIds",
  "personIds",
  "resourceIds",
] as const satisfies ReadonlyArray<keyof CourseMutationInput>;

const OPTIONAL_STRING_FIELDS = [
  "code",
  "semester",
  "description",
  "homepageUrl",
  "instructorName",
  "location",
  "color",
] as const satisfies ReadonlyArray<keyof CourseMutationInput>;

function toId(value: unknown): string {
  return String(value);
}

function toIsoString(value: unknown): string | undefined {
  if (!value) return undefined;
  const date = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(date.getTime())) return undefined;
  return date.toISOString();
}

function cleanString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function cleanStringOrEmpty(value: unknown): string {
  return cleanString(value) ?? "";
}

function parseDate(value: unknown): Date | null | undefined {
  if (value === null || value === "") return null;
  if (value === undefined) return undefined;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function normalizeObjectIds(value: unknown): mongoose.Types.ObjectId[] {
  if (!Array.isArray(value)) return [];

  const seen = new Set<string>();
  for (const item of value) {
    if (typeof item !== "string" || !mongoose.Types.ObjectId.isValid(item)) {
      continue;
    }
    seen.add(item);
  }

  return [...seen].map((id) => new mongoose.Types.ObjectId(id));
}

function getArray(value: unknown): RawRecord[] {
  return Array.isArray(value)
    ? value.filter(
        (item): item is RawRecord => !!item && typeof item === "object",
      )
    : [];
}

function serializeIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map(toId);
}

function serializeLinks(value: unknown): CourseWire["links"] {
  return getArray(value)
    .map((link) => ({
      _id: toId(link._id),
      label: cleanStringOrEmpty(link.label),
      url: cleanStringOrEmpty(link.url),
      icon: cleanString(link.icon),
    }))
    .filter((link) => link.label && link.url);
}

function serializeCustomFields(value: unknown): CourseWire["customFields"] {
  return getArray(value)
    .map((field) => ({
      _id: toId(field._id),
      label: cleanStringOrEmpty(field.label),
      value: cleanStringOrEmpty(field.value),
    }))
    .filter((field) => field.label && field.value);
}

function serializeManualDeadlines(
  value: unknown,
): CourseWire["manualDeadlines"] {
  const deadlines: CourseWire["manualDeadlines"] = [];

  for (const deadline of getArray(value)) {
    const dueAt = toIsoString(deadline.dueAt);
    const title = cleanString(deadline.title);
    if (!dueAt || !title) continue;
    deadlines.push({
      _id: toId(deadline._id),
      title,
      dueAt,
      notes: cleanString(deadline.notes),
      url: cleanString(deadline.url),
      completed: Boolean(deadline.completed),
    });
  }

  return deadlines;
}

function normalizeLinks(value: unknown) {
  return getArray(value)
    .map((link) => ({
      label: cleanStringOrEmpty(link.label),
      url: cleanStringOrEmpty(link.url),
      icon: cleanString(link.icon),
    }))
    .filter((link) => link.label && link.url);
}

function normalizeCustomFields(value: unknown) {
  return getArray(value)
    .map((field) => ({
      label: cleanStringOrEmpty(field.label),
      value: cleanStringOrEmpty(field.value),
    }))
    .filter((field) => field.label && field.value);
}

function normalizeManualDeadlines(value: unknown) {
  const deadlines: Array<{
    title: string;
    dueAt: Date;
    notes?: string;
    url?: string;
    completed: boolean;
  }> = [];

  for (const deadline of getArray(value)) {
    const dueAt = parseDate(deadline.dueAt);
    const title = cleanString(deadline.title);
    if (!dueAt || !title) continue;
    deadlines.push({
      title,
      dueAt,
      notes: cleanString(deadline.notes),
      url: cleanString(deadline.url),
      completed: Boolean(deadline.completed),
    });
  }

  return deadlines;
}

export function normalizeCourseMutation(data: CourseMutationInput) {
  const update: Record<string, unknown> = {};

  if ("name" in data) update.name = cleanStringOrEmpty(data.name);

  for (const field of OPTIONAL_STRING_FIELDS) {
    if (field in data) update[field] = cleanStringOrEmpty(data[field]);
  }

  if ("status" in data) {
    update.status = data.status === "archived" ? "archived" : "active";
  }

  if ("startsOn" in data) {
    const startsOn = parseDate(data.startsOn);
    if (startsOn !== undefined) update.startsOn = startsOn;
  }

  if ("endsOn" in data) {
    const endsOn = parseDate(data.endsOn);
    if (endsOn !== undefined) update.endsOn = endsOn;
  }

  if ("links" in data) update.links = normalizeLinks(data.links);
  if ("customFields" in data) {
    update.customFields = normalizeCustomFields(data.customFields);
  }
  if ("manualDeadlines" in data) {
    update.manualDeadlines = normalizeManualDeadlines(data.manualDeadlines);
  }

  for (const field of ID_ARRAY_FIELDS) {
    if (field in data) update[field] = normalizeObjectIds(data[field]);
  }

  return update;
}

export function serializeCourse(course: RawRecord): CourseWire {
  const createdAt = toIsoString(course.createdAt) ?? new Date().toISOString();
  const updatedAt = toIsoString(course.updatedAt) ?? createdAt;

  return {
    _id: toId(course._id),
    name: cleanStringOrEmpty(course.name),
    code: cleanString(course.code),
    semester: cleanString(course.semester),
    description: cleanString(course.description),
    homepageUrl: cleanString(course.homepageUrl),
    instructorName: cleanString(course.instructorName),
    location: cleanString(course.location),
    color: cleanString(course.color),
    status: course.status === "archived" ? "archived" : "active",
    startsOn: toIsoString(course.startsOn),
    endsOn: toIsoString(course.endsOn),
    links: serializeLinks(course.links),
    customFields: serializeCustomFields(course.customFields),
    manualDeadlines: serializeManualDeadlines(course.manualDeadlines),
    timetableEntryIds: serializeIds(course.timetableEntryIds),
    calendarEventIds: serializeIds(course.calendarEventIds),
    kanbanBoardIds: serializeIds(course.kanbanBoardIds),
    noteIds: serializeIds(course.noteIds),
    personIds: serializeIds(course.personIds),
    resourceIds: serializeIds(course.resourceIds),
    createdAt,
    updatedAt,
  };
}

function sortByIdOrder<T extends { _id: string }>(
  items: T[],
  ids: string[],
): T[] {
  const order = new Map(ids.map((id, index) => [id, index] as const));
  return [...items].sort(
    (a, b) => (order.get(a._id) ?? 0) - (order.get(b._id) ?? 0),
  );
}

function buildDeadlines(
  course: CourseWire,
  kanbanCards: ICourseKanbanCardSummary[],
  boardsById: Map<string, ICourseKanbanBoardSummary>,
): ICourseDeadline[] {
  const now = Date.now();

  const manual = course.manualDeadlines.map((deadline) => ({
    _id: `manual:${deadline._id}`,
    title: deadline.title,
    dueAt: deadline.dueAt,
    source: "manual" as const,
    sourceId: deadline._id,
    notes: deadline.notes,
    url: deadline.url,
    completed: deadline.completed,
    overdue: !deadline.completed && new Date(deadline.dueAt).getTime() < now,
  }));

  const kanban = kanbanCards
    .filter((card) => Boolean(card.dueDate))
    .map((card) => {
      const dueAt = card.dueDate ?? new Date().toISOString();
      return {
        _id: `kanban:${card._id}`,
        title: card.title,
        dueAt,
        source: "kanban" as const,
        sourceId: card._id,
        sourceLabel: boardsById.get(card.boardId)?.title,
        priority: card.priority,
        notes: card.description,
        completed: false,
        overdue: new Date(dueAt).getTime() < now,
      };
    });

  return [...manual, ...kanban].sort(
    (a, b) => new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime(),
  );
}

function buildStats(
  course: CourseWire,
  kanbanCards: ICourseKanbanCardSummary[],
  deadlines: ICourseDeadline[],
): ICourseStats {
  return {
    timetableEntries: course.timetableEntryIds.length,
    calendarEvents: course.calendarEventIds.length,
    kanbanBoards: course.kanbanBoardIds.length,
    kanbanCards: kanbanCards.length,
    dueCards: kanbanCards.filter((card) => Boolean(card.dueDate)).length,
    notes: course.noteIds.length,
    people: course.personIds.length,
    resources: course.resourceIds.length,
    openManualDeadlines: course.manualDeadlines.filter(
      (deadline) => !deadline.completed,
    ).length,
    overdueDeadlines: deadlines.filter((deadline) => deadline.overdue).length,
  };
}

function toTimetableSummary(entry: RawRecord): ICourseTimetableSummary {
  return {
    _id: toId(entry._id),
    title: cleanStringOrEmpty(entry.title),
    dayOfWeek: Number(entry.dayOfWeek ?? 0),
    startTime: cleanStringOrEmpty(entry.startTime),
    endTime: cleanStringOrEmpty(entry.endTime),
    place: cleanString(entry.place),
    color:
      typeof entry.color === "string"
        ? (entry.color as ICourseTimetableSummary["color"])
        : "accent",
    isActive: entry.isActive !== false,
  };
}

function toCalendarSummary(event: RawRecord): ICourseCalendarSummary {
  const date = toIsoString(event.date) ?? new Date().toISOString();
  return {
    _id: toId(event._id),
    title: cleanStringOrEmpty(event.title),
    date,
    calendarDate: cleanString(event.calendarDate) ?? date.slice(0, 10),
    isAllDay: Boolean(event.isAllDay),
    kind:
      typeof event.kind === "string"
        ? (event.kind as ICourseCalendarSummary["kind"])
        : "manual",
    place: cleanString(event.place),
    status:
      typeof event.status === "string"
        ? (event.status as ICourseCalendarSummary["status"])
        : "scheduled",
  };
}

function toKanbanCardSummary(card: RawRecord): ICourseKanbanCardSummary {
  return {
    _id: toId(card._id),
    boardId: toId(card.boardId),
    columnId: toId(card.columnId),
    title: cleanStringOrEmpty(card.title),
    description: cleanString(card.description),
    labels: Array.isArray(card.labels)
      ? card.labels.filter(
          (label): label is string => typeof label === "string",
        )
      : [],
    priority:
      typeof card.priority === "string"
        ? (card.priority as ICourseKanbanCardSummary["priority"])
        : "none",
    dueDate: toIsoString(card.dueDate),
  };
}

function toNoteSummary(note: RawRecord): ICourseNoteSummary {
  const updatedAt = toIsoString(note.updatedAt) ?? new Date().toISOString();
  return {
    _id: toId(note._id),
    title: cleanStringOrEmpty(note.title),
    description: cleanString(note.description),
    url: cleanString(note.url),
    tags: Array.isArray(note.tags)
      ? note.tags.filter((tag): tag is string => typeof tag === "string")
      : [],
    status: note.status === "archived" ? "archived" : "open",
    updatedAt,
  };
}

function toPersonSummary(person: RawRecord): ICoursePersonSummary {
  return {
    _id: toId(person._id),
    name: cleanStringOrEmpty(person.name),
    email: cleanString(person.email),
    phone: cleanString(person.phone),
    website: cleanString(person.website),
    notes: cleanStringOrEmpty(person.notes),
  };
}

function toResourceSummary(resource: RawRecord): ICourseResourceSummary {
  return {
    _id: toId(resource._id),
    name: cleanStringOrEmpty(resource.name),
    description: cleanStringOrEmpty(resource.description),
    url: cleanStringOrEmpty(resource.url),
    type:
      typeof resource.type === "string"
        ? (resource.type as ICourseResourceSummary["type"])
        : "service",
    isActive: resource.isActive !== false,
    isPublic: resource.isPublic !== false,
  };
}

async function findByIds(model: LeanFindModel, ids: string[]) {
  if (ids.length === 0) return [];
  return model.find({ _id: { $in: ids } }).lean<RawRecord[]>();
}

async function getCourseKanbanCards(boardIds: string[]) {
  if (boardIds.length === 0) return [];
  const cards = await KanbanCard.find({
    boardId: { $in: boardIds },
    isArchived: false,
  })
    .sort({ dueDate: 1, order: 1 })
    .lean<RawRecord[]>();
  return cards.map(toKanbanCardSummary);
}

function buildBoardSummaries(
  boards: RawRecord[],
  cards: ICourseKanbanCardSummary[],
): ICourseKanbanBoardSummary[] {
  const cardCounts = new Map<string, number>();
  const dueCounts = new Map<string, number>();

  for (const card of cards) {
    cardCounts.set(card.boardId, (cardCounts.get(card.boardId) ?? 0) + 1);
    if (card.dueDate) {
      dueCounts.set(card.boardId, (dueCounts.get(card.boardId) ?? 0) + 1);
    }
  }

  return boards.map((board) => {
    const id = toId(board._id);
    return {
      _id: id,
      title: cleanStringOrEmpty(board.title),
      description: cleanString(board.description),
      color: cleanString(board.color),
      cardCount: cardCounts.get(id) ?? 0,
      dueCardCount: dueCounts.get(id) ?? 0,
    };
  });
}

export async function getCourses(): Promise<ICourseListItem[]> {
  await connectDB();
  const rawCourses = await Course.find({ status: { $ne: "archived" } })
    .sort({ semester: -1, name: 1 })
    .lean<RawRecord[]>();
  const courses = rawCourses.map(serializeCourse);
  const linkedBoardIds = [
    ...new Set(courses.flatMap((course) => course.kanbanBoardIds)),
  ];
  const kanbanCards = await getCourseKanbanCards(linkedBoardIds);
  const cardsByBoard = new Map<string, ICourseKanbanCardSummary[]>();

  for (const card of kanbanCards) {
    const list = cardsByBoard.get(card.boardId) ?? [];
    list.push(card);
    cardsByBoard.set(card.boardId, list);
  }

  return courses.map((course) => {
    const courseCards = course.kanbanBoardIds.flatMap(
      (boardId) => cardsByBoard.get(boardId) ?? [],
    );
    const deadlines = buildDeadlines(course, courseCards, new Map());
    return {
      course,
      stats: buildStats(course, courseCards, deadlines),
      nextDeadline: deadlines.find((deadline) => !deadline.completed),
    };
  });
}

export async function getCourseById(id: string): Promise<CourseWire | null> {
  if (!mongoose.Types.ObjectId.isValid(id)) return null;
  await connectDB();
  const course = await Course.findById(id).lean<RawRecord>();
  return course ? serializeCourse(course) : null;
}

export async function getCourseDetail(
  id: string,
): Promise<ICourseDetail | null> {
  if (!mongoose.Types.ObjectId.isValid(id)) return null;
  await connectDB();

  const rawCourse = await Course.findById(id).lean<RawRecord>();
  if (!rawCourse) return null;

  const course = serializeCourse(rawCourse);
  const [
    rawTimetableEntries,
    rawCalendarEvents,
    rawBoards,
    rawNotes,
    rawPeople,
    rawResources,
    kanbanCards,
  ] = await Promise.all([
    findByIds(TimetableEntry, course.timetableEntryIds),
    findByIds(CalendarEvent, course.calendarEventIds),
    findByIds(KanbanBoard, course.kanbanBoardIds),
    findByIds(Note, course.noteIds),
    findByIds(Person, course.personIds),
    findByIds(Resource, course.resourceIds),
    getCourseKanbanCards(course.kanbanBoardIds),
  ]);

  const timetableEntries = sortByIdOrder(
    rawTimetableEntries.map(toTimetableSummary),
    course.timetableEntryIds,
  ).sort(
    (a, b) =>
      a.dayOfWeek - b.dayOfWeek || a.startTime.localeCompare(b.startTime),
  );
  const calendarEvents = sortByIdOrder(
    rawCalendarEvents.map(toCalendarSummary),
    course.calendarEventIds,
  ).sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  const kanbanBoards = sortByIdOrder(
    buildBoardSummaries(rawBoards, kanbanCards),
    course.kanbanBoardIds,
  );
  const boardsById = new Map(kanbanBoards.map((board) => [board._id, board]));
  const notes = sortByIdOrder(rawNotes.map(toNoteSummary), course.noteIds);
  const people = sortByIdOrder(
    rawPeople.map(toPersonSummary),
    course.personIds,
  );
  const resources = sortByIdOrder(
    rawResources.map(toResourceSummary),
    course.resourceIds,
  );
  const deadlines = buildDeadlines(course, kanbanCards, boardsById);
  const emails = await getCourseRelatedEmails(id);

  return {
    course,
    stats: buildStats(course, kanbanCards, deadlines),
    deadlines,
    timetableEntries,
    calendarEvents,
    kanbanBoards,
    kanbanCards,
    notes,
    people,
    resources,
    emails,
  };
}

export async function createCourse(
  data: CourseMutationInput,
): Promise<CourseWire | null> {
  const name = cleanString(data.name);
  if (!name) return null;

  await connectDB();
  const payload = normalizeCourseMutation({
    ...data,
    name,
    status: data.status ?? "active",
  });
  const course = await Course.create(payload);
  return serializeCourse(course.toObject() as unknown as RawRecord);
}

export async function updateCourse(
  id: string,
  data: CourseMutationInput,
): Promise<CourseWire | null> {
  if (!mongoose.Types.ObjectId.isValid(id)) return null;
  if ("name" in data && !cleanString(data.name)) return null;

  await connectDB();
  const update = normalizeCourseMutation(data);
  const course = await Course.findByIdAndUpdate(id, update, {
    returnDocument: "after",
    runValidators: true,
  }).lean<RawRecord>();

  return course ? serializeCourse(course) : null;
}

export async function deleteCourse(id: string): Promise<boolean> {
  if (!mongoose.Types.ObjectId.isValid(id)) return false;
  await connectDB();
  const result = await Course.findByIdAndDelete(id);
  return Boolean(result);
}

export async function getCourseOptions(): Promise<ICourseOptions> {
  await connectDB();
  const now = new Date();
  const sixMonthsFromNow = new Date(now);
  sixMonthsFromNow.setMonth(sixMonthsFromNow.getMonth() + 6);

  const [
    timetableEntries,
    calendarEvents,
    kanbanBoards,
    notes,
    people,
    resources,
  ] = await Promise.all([
    TimetableEntry.find({ isActive: true })
      .sort({ dayOfWeek: 1, startTime: 1 })
      .lean<RawRecord[]>(),
    CalendarEvent.find({
      date: { $gte: now, $lte: sixMonthsFromNow },
      status: { $ne: "canceled" },
      $or: [
        { "source.isSuppressed": { $ne: true } },
        { source: { $exists: false } },
      ],
    })
      .sort({ date: 1 })
      .limit(250)
      .lean<RawRecord[]>(),
    KanbanBoard.find({ isArchived: false })
      .sort({ createdAt: -1 })
      .lean<RawRecord[]>(),
    Note.find({ status: "open" })
      .sort({ updatedAt: -1 })
      .limit(250)
      .lean<RawRecord[]>(),
    Person.find().sort({ name: 1 }).lean<RawRecord[]>(),
    Resource.find().sort({ name: 1 }).lean<RawRecord[]>(),
  ]);

  return {
    timetableEntries: timetableEntries.map((entry) => ({
      _id: toId(entry._id),
      title: cleanStringOrEmpty(entry.title),
      subtitle: `${entry.startTime ?? ""}-${entry.endTime ?? ""}`,
      meta: cleanString(entry.place),
    })),
    calendarEvents: calendarEvents.map((event) => {
      const date = toIsoString(event.date);
      return {
        _id: toId(event._id),
        title: cleanStringOrEmpty(event.title),
        subtitle: date ? date.slice(0, 10) : undefined,
        meta: cleanString(event.place),
      };
    }),
    kanbanBoards: kanbanBoards.map((board) => ({
      _id: toId(board._id),
      title: cleanStringOrEmpty(board.title),
      subtitle: cleanString(board.description),
      meta: cleanString(board.color),
    })),
    notes: notes.map((note) => ({
      _id: toId(note._id),
      title: cleanStringOrEmpty(note.title),
      subtitle: cleanString(note.description),
      meta: Array.isArray(note.tags)
        ? note.tags
            .filter((tag) => typeof tag === "string")
            .slice(0, 3)
            .join(", ")
        : undefined,
    })),
    people: people.map((person) => ({
      _id: toId(person._id),
      title: cleanStringOrEmpty(person.name),
      subtitle: cleanString(person.email) ?? cleanString(person.website),
      meta: cleanString(person.phone),
    })),
    resources: resources.map((resource) => ({
      _id: toId(resource._id),
      title: cleanStringOrEmpty(resource.name),
      subtitle: cleanString(resource.url),
      meta: cleanString(resource.type),
    })),
  };
}

function isLinkField(value: string): value is CourseLinkField {
  return (LINK_FIELDS as readonly string[]).includes(value);
}

export async function addCourseLink(
  courseId: string,
  field: CourseLinkField,
  entityId: string,
): Promise<CourseWire | null> {
  if (!mongoose.Types.ObjectId.isValid(courseId)) return null;
  if (!mongoose.Types.ObjectId.isValid(entityId)) return null;
  if (!isLinkField(field)) return null;

  await connectDB();
  const course = await Course.findByIdAndUpdate(
    courseId,
    { $addToSet: { [field]: new mongoose.Types.ObjectId(entityId) } },
    { returnDocument: "after" },
  ).lean<RawRecord>();
  return course ? serializeCourse(course) : null;
}

export async function removeCourseLink(
  courseId: string,
  field: CourseLinkField,
  entityId: string,
): Promise<CourseWire | null> {
  if (!mongoose.Types.ObjectId.isValid(courseId)) return null;
  if (!mongoose.Types.ObjectId.isValid(entityId)) return null;
  if (!isLinkField(field)) return null;

  await connectDB();
  const course = await Course.findByIdAndUpdate(
    courseId,
    { $pull: { [field]: new mongoose.Types.ObjectId(entityId) } },
    { returnDocument: "after" },
  ).lean<RawRecord>();
  return course ? serializeCourse(course) : null;
}

export async function addCourseDeadline(
  courseId: string,
  data: { title: string; dueAt: string | Date; notes?: string; url?: string },
): Promise<{ course: CourseWire; deadlineId: string } | null> {
  if (!mongoose.Types.ObjectId.isValid(courseId)) return null;
  const title = cleanString(data.title);
  const dueAt = parseDate(data.dueAt);
  if (!title || !dueAt) return null;

  await connectDB();
  const deadlineId = new mongoose.Types.ObjectId();
  const course = await Course.findByIdAndUpdate(
    courseId,
    {
      $push: {
        manualDeadlines: {
          _id: deadlineId,
          title,
          dueAt,
          notes: cleanString(data.notes),
          url: cleanString(data.url),
          completed: false,
        },
      },
    },
    { returnDocument: "after" },
  ).lean<RawRecord>();
  if (!course) return null;
  return { course: serializeCourse(course), deadlineId: deadlineId.toString() };
}

export async function updateCourseDeadline(
  courseId: string,
  deadlineId: string,
  patch: {
    title?: string;
    dueAt?: string | Date;
    notes?: string;
    completed?: boolean;
  },
): Promise<CourseWire | null> {
  if (!mongoose.Types.ObjectId.isValid(courseId)) return null;
  if (!mongoose.Types.ObjectId.isValid(deadlineId)) return null;

  const set: Record<string, unknown> = {};
  if (patch.title !== undefined) {
    const title = cleanString(patch.title);
    if (title) set["manualDeadlines.$.title"] = title;
  }
  if (patch.dueAt !== undefined) {
    const dueAt = parseDate(patch.dueAt);
    if (dueAt) set["manualDeadlines.$.dueAt"] = dueAt;
  }
  if (patch.notes !== undefined) {
    set["manualDeadlines.$.notes"] = cleanString(patch.notes) ?? "";
  }
  if (patch.completed !== undefined) {
    set["manualDeadlines.$.completed"] = Boolean(patch.completed);
  }
  if (Object.keys(set).length === 0) return getCourseById(courseId);

  await connectDB();
  const course = await Course.findOneAndUpdate(
    {
      _id: courseId,
      "manualDeadlines._id": new mongoose.Types.ObjectId(deadlineId),
    },
    { $set: set },
    { returnDocument: "after" },
  ).lean<RawRecord>();
  return course ? serializeCourse(course) : null;
}

export function completeCourseDeadline(
  courseId: string,
  deadlineId: string,
  completed: boolean,
): Promise<CourseWire | null> {
  return updateCourseDeadline(courseId, deadlineId, { completed });
}

function coerceTriageCategory(value: unknown): TriageCategory {
  return typeof value === "string" &&
    (TRIAGE_CATEGORIES as readonly string[]).includes(value)
    ? (value as TriageCategory)
    : "fyi";
}

function formatEmailFrom(value: unknown): string {
  return getArray(value)
    .map((entry) => {
      const name = cleanString(entry.name);
      const address = cleanString(entry.address);
      if (!address) return name ?? "";
      return name ? `${name} <${address}>` : address;
    })
    .filter(Boolean)
    .join(", ");
}

export async function getCourseRelatedEmails(
  courseId: string,
): Promise<ICourseEmailSummary[]> {
  if (!mongoose.Types.ObjectId.isValid(courseId)) return [];
  await connectDB();

  const triages = await EmailTriageModel.find({ matchedCourseId: courseId })
    .sort({ triagedAt: -1 })
    .limit(50)
    .lean<RawRecord[]>();
  if (triages.length === 0) return [];

  const emailIds = [...new Set(triages.map((triage) => toId(triage.emailId)))];
  const emails = await EmailModel.find({ _id: { $in: emailIds } })
    .select("subject from date")
    .lean<RawRecord[]>();
  const emailsById = new Map(emails.map((email) => [toId(email._id), email]));

  return triages.map((triage) => {
    const email = emailsById.get(toId(triage.emailId));
    return {
      _id: toId(triage._id),
      triageId: toId(triage._id),
      emailId: toId(triage.emailId),
      subject: cleanString(email?.subject) ?? "(no subject)",
      from: formatEmailFrom(email?.from) || "Unknown sender",
      date:
        toIsoString(email?.date) ??
        toIsoString(triage.triagedAt) ??
        new Date().toISOString(),
      category: coerceTriageCategory(triage.category),
      summary: cleanString(triage.summary),
    };
  });
}

export async function getCoursesForMatching(): Promise<CourseMatchCandidate[]> {
  await connectDB();
  const courses = await Course.find({ status: "active" })
    .select(
      "name code instructorName manualDeadlines calendarEventIds kanbanBoardIds",
    )
    .lean<RawRecord[]>();
  if (courses.length === 0) return [];

  const allEventIds = [
    ...new Set(
      courses.flatMap((course) => serializeIds(course.calendarEventIds)),
    ),
  ];
  const events = allEventIds.length
    ? await CalendarEvent.find({ _id: { $in: allEventIds } })
        .select("title date")
        .lean<RawRecord[]>()
    : [];
  const eventsById = new Map(events.map((event) => [toId(event._id), event]));
  const cutoff = Date.now() - 1000 * 60 * 60 * 24;

  return courses.map((course) => {
    const openDeadlines = serializeManualDeadlines(course.manualDeadlines)
      .filter((deadline) => !deadline.completed)
      .map((deadline) => ({
        _id: deadline._id,
        title: deadline.title,
        dueAt: deadline.dueAt,
      }));
    const upcomingEvents = serializeIds(course.calendarEventIds)
      .map((eventId) => eventsById.get(eventId))
      .filter((event): event is RawRecord => Boolean(event))
      .map((event) => ({
        _id: toId(event._id),
        title: cleanStringOrEmpty(event.title),
        date: toIsoString(event.date) ?? "",
      }))
      .filter(
        (event) => event.date && new Date(event.date).getTime() >= cutoff,
      );

    return {
      _id: toId(course._id),
      name: cleanStringOrEmpty(course.name),
      code: cleanString(course.code),
      instructorName: cleanString(course.instructorName),
      boardIds: serializeIds(course.kanbanBoardIds),
      openDeadlines,
      upcomingEvents,
    };
  });
}

export function parseCourseStatus(value: unknown): CourseStatus {
  return value === "archived" ? "archived" : "active";
}
