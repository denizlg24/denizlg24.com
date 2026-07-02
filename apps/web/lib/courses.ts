import type {
  CourseAssignmentStatus,
  CourseAssignmentType,
  ICourseAssignment as CourseAssignmentWire,
  CourseStatus,
  ICourse as CourseWire,
  ICourseAssignmentGrade,
  ICourseCalendarSummary,
  ICourseDeadline,
  ICourseDetail,
  ICourseEmailSummary,
  ICourseGradeProjection,
  ICourseKanbanBoardSummary,
  ICourseKanbanCardSummary,
  ICourseListItem,
  ICourseNoteSummary,
  ICourseOptions,
  ICoursePersonSummary,
  ICourseResourceSummary,
  ICourseStats,
  ICourseTimetableSummary,
  ISemesterCourseStanding,
  ISemesterDeadline,
  ISemesterOverview,
  ISemesterScheduleClass,
  ISemesterScheduleDay,
  TriageCategory,
} from "@repo/schemas";
import mongoose from "mongoose";
import { CalendarEvent } from "@/models/CalendarEvent";
import { Course } from "@/models/Course";
import { CourseAssignment } from "@/models/CourseAssignment";
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

const ASSIGNMENT_TYPES = [
  "assignment",
  "exam",
  "quiz",
  "project",
  "lab",
  "reading",
  "other",
] as const satisfies readonly CourseAssignmentType[];

const ASSIGNMENT_STATUSES = [
  "planned",
  "in-progress",
  "submitted",
  "graded",
  "archived",
] as const satisfies readonly CourseAssignmentStatus[];

const COMPLETED_ASSIGNMENT_STATUSES = new Set<CourseAssignmentStatus>([
  "submitted",
  "graded",
  "archived",
]);

export interface CourseMatchCandidate {
  _id: string;
  name: string;
  code?: string;
  instructorName?: string;
  triageContext: { label: string; value: string }[];
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
type CourseAssignmentMutationInput = Partial<
  Omit<CourseAssignmentWire, "_id" | "courseId" | "createdAt" | "updatedAt">
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

function parseNumber(value: unknown): number | undefined {
  if (value === null || value === undefined || value === "") return undefined;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
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

function serializeTriageContext(value: unknown): CourseWire["triageContext"] {
  return getArray(value)
    .map((field) => ({
      _id: toId(field._id),
      label: cleanStringOrEmpty(field.label),
      value: cleanStringOrEmpty(field.value),
      includeInTriage: field.includeInTriage === true,
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

function normalizeTriageContext(value: unknown) {
  return getArray(value)
    .map((field) => ({
      label: cleanStringOrEmpty(field.label),
      value: cleanStringOrEmpty(field.value),
      includeInTriage: field.includeInTriage === true,
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

function coerceAssignmentType(value: unknown): CourseAssignmentType {
  return typeof value === "string" &&
    (ASSIGNMENT_TYPES as readonly string[]).includes(value)
    ? (value as CourseAssignmentType)
    : "assignment";
}

function coerceAssignmentStatus(value: unknown): CourseAssignmentStatus {
  return typeof value === "string" &&
    (ASSIGNMENT_STATUSES as readonly string[]).includes(value)
    ? (value as CourseAssignmentStatus)
    : "planned";
}

function serializeAssignmentLinks(
  value: unknown,
): CourseAssignmentWire["links"] {
  return getArray(value)
    .map((link) => ({
      _id: toId(link._id),
      label: cleanStringOrEmpty(link.label),
      url: cleanStringOrEmpty(link.url),
    }))
    .filter((link) => link.label && link.url);
}

function serializeAssignmentFiles(
  value: unknown,
): CourseAssignmentWire["files"] {
  return getArray(value)
    .map((file) => ({
      _id: toId(file._id),
      name: cleanStringOrEmpty(file.name),
      url: cleanStringOrEmpty(file.url),
      mimeType: cleanString(file.mimeType),
      size: parseNumber(file.size),
    }))
    .filter((file) => file.name && file.url);
}

function serializeAssignmentGrade(
  value: unknown,
): ICourseAssignmentGrade | undefined {
  if (!value || typeof value !== "object") return undefined;
  const grade = value as RawRecord;
  const score = parseNumber(grade.score);
  const maxScore = parseNumber(grade.maxScore);
  const weight = parseNumber(grade.weight);
  const letter = cleanString(grade.letter);
  const notes = cleanString(grade.notes);
  const gradedAt = toIsoString(grade.gradedAt);
  if (
    score === undefined &&
    maxScore === undefined &&
    weight === undefined &&
    !letter &&
    !notes &&
    !gradedAt
  ) {
    return undefined;
  }

  return {
    ...(score !== undefined ? { score } : {}),
    ...(maxScore !== undefined ? { maxScore } : {}),
    ...(letter ? { letter } : {}),
    ...(weight !== undefined ? { weight } : {}),
    ...(gradedAt ? { gradedAt } : {}),
    ...(notes ? { notes } : {}),
  };
}

function serializeCourseAssignment(
  assignment: RawRecord,
): CourseAssignmentWire {
  const createdAt =
    toIsoString(assignment.createdAt) ?? new Date().toISOString();
  const updatedAt = toIsoString(assignment.updatedAt) ?? createdAt;

  return {
    _id: toId(assignment._id),
    courseId: toId(assignment.courseId),
    title: cleanStringOrEmpty(assignment.title),
    type: coerceAssignmentType(assignment.type),
    status: coerceAssignmentStatus(assignment.status),
    dueAt: toIsoString(assignment.dueAt),
    submittedAt: toIsoString(assignment.submittedAt),
    notes: cleanString(assignment.notes),
    links: serializeAssignmentLinks(assignment.links),
    files: serializeAssignmentFiles(assignment.files),
    grade: serializeAssignmentGrade(assignment.grade),
    createdAt,
    updatedAt,
  };
}

function normalizeAssignmentLinks(value: unknown) {
  return getArray(value)
    .map((link) => ({
      label: cleanStringOrEmpty(link.label),
      url: cleanStringOrEmpty(link.url),
    }))
    .filter((link) => link.label && link.url);
}

function normalizeAssignmentFiles(value: unknown) {
  return getArray(value)
    .map((file) => ({
      name: cleanStringOrEmpty(file.name),
      url: cleanStringOrEmpty(file.url),
      mimeType: cleanString(file.mimeType),
      size: parseNumber(file.size),
    }))
    .filter((file) => file.name && file.url);
}

function normalizeAssignmentGrade(value: unknown) {
  if (!value || typeof value !== "object") return undefined;
  const grade = value as RawRecord;
  const score = parseNumber(grade.score);
  const maxScore = parseNumber(grade.maxScore);
  const weight = parseNumber(grade.weight);
  const gradedAt = parseDate(grade.gradedAt);
  const normalized = {
    ...(score !== undefined ? { score } : {}),
    ...(maxScore !== undefined ? { maxScore } : {}),
    ...(cleanString(grade.letter) ? { letter: cleanString(grade.letter) } : {}),
    ...(weight !== undefined ? { weight } : {}),
    ...(gradedAt ? { gradedAt } : {}),
    ...(cleanString(grade.notes) ? { notes: cleanString(grade.notes) } : {}),
  };

  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

function normalizeAssignmentMutation(data: CourseAssignmentMutationInput) {
  const update: Record<string, unknown> = {};

  if ("title" in data) update.title = cleanStringOrEmpty(data.title);
  if ("type" in data) update.type = coerceAssignmentType(data.type);
  if ("status" in data) update.status = coerceAssignmentStatus(data.status);

  if ("dueAt" in data) {
    const dueAt = parseDate(data.dueAt);
    if (dueAt !== undefined) update.dueAt = dueAt;
  }

  if ("submittedAt" in data) {
    const submittedAt = parseDate(data.submittedAt);
    if (submittedAt !== undefined) update.submittedAt = submittedAt;
  }

  if ("notes" in data) update.notes = cleanString(data.notes) ?? "";
  if ("links" in data) update.links = normalizeAssignmentLinks(data.links);
  if ("files" in data) update.files = normalizeAssignmentFiles(data.files);
  if ("grade" in data) update.grade = normalizeAssignmentGrade(data.grade);

  return update;
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
  if ("triageContext" in data) {
    update.triageContext = normalizeTriageContext(data.triageContext);
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
    triageContext: serializeTriageContext(course.triageContext),
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
  assignments: CourseAssignmentWire[],
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

  const assignmentDeadlines = assignments
    .filter(
      (assignment) => assignment.dueAt && assignment.status !== "archived",
    )
    .map((assignment) => {
      const dueAt = assignment.dueAt ?? new Date().toISOString();
      const completed = COMPLETED_ASSIGNMENT_STATUSES.has(assignment.status);
      return {
        _id: `assignment:${assignment._id}`,
        title: assignment.title,
        dueAt,
        source: "assignment" as const,
        sourceId: assignment._id,
        sourceLabel: assignment.type,
        notes: assignment.notes,
        url: assignment.links[0]?.url,
        completed,
        overdue: !completed && new Date(dueAt).getTime() < now,
      };
    });

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

  return [...manual, ...assignmentDeadlines, ...kanban].sort(
    (a, b) => new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime(),
  );
}

function getAssignmentGradePercent(
  assignment: CourseAssignmentWire,
): number | undefined {
  const score = assignment.grade?.score;
  const maxScore = assignment.grade?.maxScore;
  if (score === undefined || maxScore === undefined || maxScore <= 0) {
    return undefined;
  }
  return (score / maxScore) * 100;
}

function calculateGradeAverage(assignments: CourseAssignmentWire[]) {
  const graded: { percent: number; weight?: number }[] = [];
  for (const assignment of assignments) {
    const percent = getAssignmentGradePercent(assignment);
    if (percent !== undefined) {
      graded.push({ percent, weight: assignment.grade?.weight });
    }
  }
  if (graded.length === 0) return null;

  const weighted = graded.filter(
    (grade) => grade.weight !== undefined && grade.weight > 0,
  );
  if (weighted.length > 0) {
    const totalWeight = weighted.reduce(
      (sum, grade) => sum + (grade.weight ?? 0),
      0,
    );
    if (totalWeight > 0) {
      return (
        weighted.reduce(
          (sum, grade) => sum + grade.percent * (grade.weight ?? 0),
          0,
        ) / totalWeight
      );
    }
  }

  return graded.reduce((sum, grade) => sum + grade.percent, 0) / graded.length;
}

function buildStats(
  course: CourseWire,
  kanbanCards: ICourseKanbanCardSummary[],
  deadlines: ICourseDeadline[],
  assignments: CourseAssignmentWire[],
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
    assignments: assignments.filter(
      (assignment) => assignment.status !== "archived",
    ).length,
    openAssignments: assignments.filter(
      (assignment) =>
        assignment.status !== "archived" &&
        !COMPLETED_ASSIGNMENT_STATUSES.has(assignment.status),
    ).length,
    gradedAssignments: assignments.filter(
      (assignment) => assignment.grade?.score !== undefined,
    ).length,
    gradeAverage: calculateGradeAverage(assignments),
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

async function getCourseAssignments(courseIds: string[]) {
  const validIds = courseIds.filter((id) =>
    mongoose.Types.ObjectId.isValid(id),
  );
  if (validIds.length === 0) return [];
  const assignments = await CourseAssignment.find({
    courseId: { $in: validIds },
  })
    .sort({ dueAt: 1, updatedAt: -1 })
    .lean<RawRecord[]>();
  return assignments.map(serializeCourseAssignment);
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
  const [kanbanCards, assignments] = await Promise.all([
    getCourseKanbanCards(linkedBoardIds),
    getCourseAssignments(courses.map((course) => course._id)),
  ]);
  const cardsByBoard = new Map<string, ICourseKanbanCardSummary[]>();
  const assignmentsByCourse = new Map<string, CourseAssignmentWire[]>();

  for (const card of kanbanCards) {
    const list = cardsByBoard.get(card.boardId) ?? [];
    list.push(card);
    cardsByBoard.set(card.boardId, list);
  }

  for (const assignment of assignments) {
    const list = assignmentsByCourse.get(assignment.courseId) ?? [];
    list.push(assignment);
    assignmentsByCourse.set(assignment.courseId, list);
  }

  return courses.map((course) => {
    const courseCards = course.kanbanBoardIds.flatMap(
      (boardId) => cardsByBoard.get(boardId) ?? [],
    );
    const courseAssignments = assignmentsByCourse.get(course._id) ?? [];
    const deadlines = buildDeadlines(
      course,
      courseCards,
      new Map(),
      courseAssignments,
    );
    return {
      course,
      stats: buildStats(course, courseCards, deadlines, courseAssignments),
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
    rawAssignments,
  ] = await Promise.all([
    findByIds(TimetableEntry, course.timetableEntryIds),
    findByIds(CalendarEvent, course.calendarEventIds),
    findByIds(KanbanBoard, course.kanbanBoardIds),
    findByIds(Note, course.noteIds),
    findByIds(Person, course.personIds),
    findByIds(Resource, course.resourceIds),
    getCourseKanbanCards(course.kanbanBoardIds),
    CourseAssignment.find({ courseId: id })
      .sort({ dueAt: 1, updatedAt: -1 })
      .lean<RawRecord[]>(),
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
  const assignments = rawAssignments.map(serializeCourseAssignment);
  const deadlines = buildDeadlines(
    course,
    kanbanCards,
    boardsById,
    assignments,
  );
  const emails = await getCourseRelatedEmails(id);

  return {
    course,
    stats: buildStats(course, kanbanCards, deadlines, assignments),
    deadlines,
    timetableEntries,
    calendarEvents,
    kanbanBoards,
    kanbanCards,
    assignments,
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
  if (result) {
    await CourseAssignment.deleteMany({ courseId: id });
  }
  return Boolean(result);
}

export async function createCourseAssignment(
  courseId: string,
  data: CourseAssignmentMutationInput,
): Promise<CourseAssignmentWire | null> {
  if (!mongoose.Types.ObjectId.isValid(courseId)) return null;
  const title = cleanString(data.title);
  if (!title) return null;

  await connectDB();
  const courseExists = await Course.exists({ _id: courseId });
  if (!courseExists) return null;

  const payload = normalizeAssignmentMutation({
    ...data,
    title,
    status: data.status ?? "planned",
    type: data.type ?? "assignment",
  });
  const assignment = await CourseAssignment.create({
    ...payload,
    courseId: new mongoose.Types.ObjectId(courseId),
  });
  return serializeCourseAssignment(
    assignment.toObject() as unknown as RawRecord,
  );
}

export async function updateCourseAssignment(
  courseId: string,
  assignmentId: string,
  data: CourseAssignmentMutationInput,
): Promise<CourseAssignmentWire | null> {
  if (!mongoose.Types.ObjectId.isValid(courseId)) return null;
  if (!mongoose.Types.ObjectId.isValid(assignmentId)) return null;
  if ("title" in data && !cleanString(data.title)) return null;

  await connectDB();
  const update = normalizeAssignmentMutation(data);
  const assignment = await CourseAssignment.findOneAndUpdate(
    { _id: assignmentId, courseId },
    update,
    { returnDocument: "after", runValidators: true },
  ).lean<RawRecord>();
  return assignment ? serializeCourseAssignment(assignment) : null;
}

export async function deleteCourseAssignment(
  courseId: string,
  assignmentId: string,
): Promise<boolean> {
  if (!mongoose.Types.ObjectId.isValid(courseId)) return false;
  if (!mongoose.Types.ObjectId.isValid(assignmentId)) return false;

  await connectDB();
  const result = await CourseAssignment.deleteOne({
    _id: assignmentId,
    courseId,
  });
  return result.deletedCount > 0;
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
      "name code instructorName triageContext manualDeadlines calendarEventIds kanbanBoardIds",
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
      triageContext: serializeTriageContext(course.triageContext)
        .filter((field) => field.includeInTriage)
        .map((field) => ({
          label: field.label,
          value: field.value,
        })),
      boardIds: serializeIds(course.kanbanBoardIds),
      openDeadlines,
      upcomingEvents,
    };
  });
}

export function parseCourseStatus(value: unknown): CourseStatus {
  return value === "archived" ? "archived" : "active";
}

export function computeGradeProjection(
  assignments: CourseAssignmentWire[],
): ICourseGradeProjection {
  const active = assignments.filter(
    (assignment) => assignment.status !== "archived",
  );
  const currentAverage = calculateGradeAverage(active);

  const gradedWeighted = active
    .map((assignment) => ({
      percent: getAssignmentGradePercent(assignment),
      weight: assignment.grade?.weight,
    }))
    .filter(
      (grade): grade is { percent: number; weight: number } =>
        grade.percent !== undefined &&
        grade.weight !== undefined &&
        grade.weight > 0,
    );

  if (gradedWeighted.length === 0) {
    return {
      currentAverage,
      gradedWeight: null,
      remainingWeight: null,
      bestCase: null,
      worstCase: null,
    };
  }

  // Weights are shares of the final grade; clamp so malformed weights
  // (summing past 100) cannot produce projections outside 0-100.
  const gradedWeight = Math.min(
    100,
    gradedWeighted.reduce((sum, grade) => sum + grade.weight, 0),
  );
  const remainingWeight = Math.max(0, 100 - gradedWeight);
  const earned = Math.min(
    gradedWeight,
    gradedWeighted.reduce(
      (sum, grade) => sum + (grade.percent * grade.weight) / 100,
      0,
    ),
  );

  return {
    currentAverage,
    gradedWeight,
    remainingWeight,
    bestCase: earned + remainingWeight,
    worstCase: earned,
  };
}

export function requiredAverageForTarget(
  projection: ICourseGradeProjection,
  target: number,
): number | null {
  if (
    projection.remainingWeight === null ||
    projection.worstCase === null ||
    projection.remainingWeight <= 0
  ) {
    return null;
  }
  return ((target - projection.worstCase) / projection.remainingWeight) * 100;
}

export async function getCourseGradeProjection(courseId: string): Promise<{
  course: { _id: string; name: string; code?: string };
  assignments: number;
  projection: ICourseGradeProjection;
} | null> {
  if (!mongoose.Types.ObjectId.isValid(courseId)) return null;
  await connectDB();
  const course = await Course.findById(courseId)
    .select("name code")
    .lean<RawRecord>();
  if (!course) return null;
  const assignments = await getCourseAssignments([courseId]);
  return {
    course: {
      _id: toId(course._id),
      name: cleanStringOrEmpty(course.name),
      code: cleanString(course.code),
    },
    assignments: assignments.filter(
      (assignment) => assignment.status !== "archived",
    ).length,
    projection: computeGradeProjection(assignments),
  };
}

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function toDateKey(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

export async function getSemesterOverview(): Promise<ISemesterOverview> {
  await connectDB();
  const rawCourses = await Course.find({ status: "active" })
    .sort({ semester: -1, name: 1 })
    .lean<RawRecord[]>();
  const courses = rawCourses.map(serializeCourse);

  const boardIds = [
    ...new Set(courses.flatMap((course) => course.kanbanBoardIds)),
  ];
  const timetableEntryIds = [
    ...new Set(courses.flatMap((course) => course.timetableEntryIds)),
  ];
  const [kanbanCards, assignments, rawTimetableEntries] = await Promise.all([
    getCourseKanbanCards(boardIds),
    getCourseAssignments(courses.map((course) => course._id)),
    findByIds(TimetableEntry, timetableEntryIds),
  ]);

  const cardsByBoard = new Map<string, ICourseKanbanCardSummary[]>();
  for (const card of kanbanCards) {
    const list = cardsByBoard.get(card.boardId) ?? [];
    list.push(card);
    cardsByBoard.set(card.boardId, list);
  }
  const assignmentsByCourse = new Map<string, CourseAssignmentWire[]>();
  for (const assignment of assignments) {
    const list = assignmentsByCourse.get(assignment.courseId) ?? [];
    list.push(assignment);
    assignmentsByCourse.set(assignment.courseId, list);
  }
  const timetableById = new Map(
    rawTimetableEntries.map((entry) => [
      toId(entry._id),
      toTimetableSummary(entry),
    ]),
  );

  const now = Date.now();
  const in7Days = now + 7 * 24 * 60 * 60 * 1000;
  const in14Days = now + 14 * 24 * 60 * 60 * 1000;

  const standings: ISemesterCourseStanding[] = [];
  const radar: ISemesterDeadline[] = [];
  let openAssignments = 0;
  let gradedAssignments = 0;

  for (const course of courses) {
    const courseCards = course.kanbanBoardIds.flatMap(
      (boardId) => cardsByBoard.get(boardId) ?? [],
    );
    const courseAssignments = assignmentsByCourse.get(course._id) ?? [];
    const deadlines = buildDeadlines(
      course,
      courseCards,
      new Map(),
      courseAssignments,
    );
    const open = deadlines.filter((deadline) => !deadline.completed);
    const withCourse = (deadline: ICourseDeadline): ISemesterDeadline => ({
      ...deadline,
      courseId: course._id,
      courseName: course.name,
      courseCode: course.code,
      courseColor: course.color,
    });
    for (const deadline of open) {
      const dueTime = new Date(deadline.dueAt).getTime();
      if (deadline.overdue || (dueTime >= now && dueTime <= in14Days)) {
        radar.push(withCourse(deadline));
      }
    }

    const projection = computeGradeProjection(courseAssignments);
    const activeAssignments = courseAssignments.filter(
      (assignment) => assignment.status !== "archived",
    );
    const courseOpenAssignments = activeAssignments.filter(
      (assignment) => !COMPLETED_ASSIGNMENT_STATUSES.has(assignment.status),
    ).length;
    openAssignments += courseOpenAssignments;
    gradedAssignments += activeAssignments.filter(
      (assignment) => assignment.grade?.score !== undefined,
    ).length;

    standings.push({
      courseId: course._id,
      name: course.name,
      code: course.code,
      semester: course.semester,
      color: course.color,
      gradeAverage: projection.currentAverage,
      projection,
      openAssignments: courseOpenAssignments,
      dueNext7Days: open.filter((deadline) => {
        const dueTime = new Date(deadline.dueAt).getTime();
        return dueTime >= now && dueTime <= in7Days;
      }).length,
      overdue: open.filter((deadline) => deadline.overdue).length,
      nextDeadline: open[0] ? withCourse(open[0]) : undefined,
    });
  }

  radar.sort(
    (a, b) => new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime(),
  );

  const week: ISemesterScheduleDay[] = [];
  const today = new Date();
  for (let offset = 0; offset < 7; offset++) {
    const date = new Date(
      today.getFullYear(),
      today.getMonth(),
      today.getDate() + offset,
    );
    const dateKey = toDateKey(date);
    // Timetable entries use 0 = Monday … 6 = Sunday.
    const timetableDay = (date.getDay() + 6) % 7;
    const classes: ISemesterScheduleClass[] = [];
    for (const course of courses) {
      for (const entryId of course.timetableEntryIds) {
        const entry = timetableById.get(entryId);
        if (!entry?.isActive || entry.dayOfWeek !== timetableDay) {
          continue;
        }
        classes.push({
          courseId: course._id,
          courseName: course.name,
          courseColor: course.color,
          title: entry.title,
          startTime: entry.startTime,
          endTime: entry.endTime,
          place: entry.place,
        });
      }
    }
    classes.sort((a, b) => a.startTime.localeCompare(b.startTime));
    week.push({
      date: dateKey,
      label: DAY_LABELS[date.getDay()],
      isToday: offset === 0,
      classes,
      deadlineCount: radar.filter(
        (deadline) => toDateKey(new Date(deadline.dueAt)) === dateKey,
      ).length,
    });
  }

  const gradedStandings = standings.filter(
    (standing) => standing.gradeAverage !== null,
  );
  const semesterAverage =
    gradedStandings.length > 0
      ? gradedStandings.reduce(
          (sum, standing) => sum + (standing.gradeAverage ?? 0),
          0,
        ) / gradedStandings.length
      : null;

  return {
    generatedAt: new Date().toISOString(),
    stats: {
      activeCourses: courses.length,
      openAssignments,
      dueNext7Days: standings.reduce(
        (sum, standing) => sum + standing.dueNext7Days,
        0,
      ),
      overdue: standings.reduce((sum, standing) => sum + standing.overdue, 0),
      gradedAssignments,
      semesterAverage,
    },
    courses: standings,
    deadlines: radar,
    week,
  };
}
