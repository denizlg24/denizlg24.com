import { z } from "zod";
import { kanbanPrioritySchema } from "./kanban";
import { paperReadingStatusSchema } from "./paper";
import { timetableColorSchema } from "./timetable";
import { triageCategorySchema } from "./triage";

export const courseStatusSchema = z.enum(["active", "archived"]);
export type CourseStatus = z.infer<typeof courseStatusSchema>;

export const courseLinkSchema = z.object({
  _id: z.string(),
  label: z.string(),
  url: z.string(),
  icon: z.string().optional(),
});
export type ICourseLink = z.infer<typeof courseLinkSchema>;

export const courseCustomFieldSchema = z.object({
  _id: z.string(),
  label: z.string(),
  value: z.string(),
});
export type ICourseCustomField = z.infer<typeof courseCustomFieldSchema>;

export const courseTriageContextSchema = z.object({
  _id: z.string(),
  label: z.string(),
  value: z.string(),
  includeInTriage: z.boolean(),
});
export type ICourseTriageContext = z.infer<typeof courseTriageContextSchema>;

export const courseManualDeadlineSchema = z.object({
  _id: z.string(),
  title: z.string(),
  dueAt: z.string(),
  notes: z.string().optional(),
  url: z.string().optional(),
  completed: z.boolean(),
});
export type ICourseManualDeadline = z.infer<typeof courseManualDeadlineSchema>;

export const courseAssignmentTypeSchema = z.enum([
  "assignment",
  "exam",
  "quiz",
  "project",
  "lab",
  "reading",
]);
export type CourseAssignmentType = z.infer<typeof courseAssignmentTypeSchema>;

export const courseAssignmentStatusSchema = z.enum([
  "planned",
  "in-progress",
  "submitted",
  "graded",
  "archived",
]);
export type CourseAssignmentStatus = z.infer<
  typeof courseAssignmentStatusSchema
>;

export const courseAssignmentLinkSchema = z.object({
  _id: z.string(),
  label: z.string(),
  url: z.string(),
});
export type ICourseAssignmentLink = z.infer<typeof courseAssignmentLinkSchema>;

export const courseAssignmentFileSchema = z.object({
  _id: z.string(),
  name: z.string(),
  url: z.string(),
  mimeType: z.string().optional(),
  size: z.number().optional(),
});
export type ICourseAssignmentFile = z.infer<typeof courseAssignmentFileSchema>;

export const courseAssignmentGradeSchema = z.object({
  score: z.number().optional(),
  maxScore: z.number().optional(),
  letter: z.string().optional(),
  weight: z.number().optional(),
  gradedAt: z.string().optional(),
  notes: z.string().optional(),
});
export type ICourseAssignmentGrade = z.infer<
  typeof courseAssignmentGradeSchema
>;

export const courseAssignmentSchema = z.object({
  _id: z.string(),
  courseId: z.string(),
  title: z.string(),
  type: courseAssignmentTypeSchema,
  /**
   * Whether this row carries a mark toward the final grade. It is deliberately
   * separate from `type`: an ungraded practice lab and a lab worth 15% are the
   * same type and belong in different lanes. Only `assessed` rows reach the
   * gradebook and the grade average; the rest are plain dated coursework and
   * live on the deadline radar alone.
   */
  assessed: z.boolean(),
  status: courseAssignmentStatusSchema,
  dueAt: z.string().optional(),
  submittedAt: z.string().optional(),
  notes: z.string().optional(),
  links: z.array(courseAssignmentLinkSchema),
  files: z.array(courseAssignmentFileSchema),
  grade: courseAssignmentGradeSchema.optional(),
  /**
   * The kanban card mirroring this assignment, when triage accepted a course
   * task into both places. The deadline builder suppresses that card so the
   * radar shows one row, not two.
   */
  kanbanCardId: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type ICourseAssignment = z.infer<typeof courseAssignmentSchema>;

export const courseSchema = z.object({
  _id: z.string(),
  name: z.string(),
  code: z.string().optional(),
  semester: z.string().optional(),
  description: z.string().optional(),
  homepageUrl: z.string().optional(),
  instructorName: z.string().optional(),
  location: z.string().optional(),
  color: z.string().optional(),
  status: courseStatusSchema,
  startsOn: z.string().optional(),
  endsOn: z.string().optional(),
  links: z.array(courseLinkSchema),
  customFields: z.array(courseCustomFieldSchema),
  triageContext: z.array(courseTriageContextSchema),
  manualDeadlines: z.array(courseManualDeadlineSchema),
  timetableEntryIds: z.array(z.string()),
  calendarEventIds: z.array(z.string()),
  kanbanBoardIds: z.array(z.string()),
  noteIds: z.array(z.string()),
  personIds: z.array(z.string()),
  resourceIds: z.array(z.string()),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type ICourse = z.infer<typeof courseSchema>;

export const courseStatsSchema = z.object({
  timetableEntries: z.number(),
  calendarEvents: z.number(),
  kanbanBoards: z.number(),
  kanbanCards: z.number(),
  dueCards: z.number(),
  notes: z.number(),
  people: z.number(),
  resources: z.number(),
  emails: z.number(),
  /** The whole deadline radar: manual, unassessed coursework, cards, readings. */
  deadlines: z.number(),
  openDeadlines: z.number(),
  overdue: z.number(),
  assessments: z.number(),
  openAssessments: z.number(),
  gradedAssessments: z.number(),
  gradeAverage: z.number().nullable(),
  readings: z.number(),
  openReadings: z.number(),
});
export type ICourseStats = z.infer<typeof courseStatsSchema>;

export const courseDeadlineSourceSchema = z.enum([
  "manual",
  "kanban",
  "assignment",
  "reading",
]);
export type CourseDeadlineSource = z.infer<typeof courseDeadlineSourceSchema>;

export const courseDeadlineSchema = z.object({
  _id: z.string(),
  title: z.string(),
  dueAt: z.string(),
  source: courseDeadlineSourceSchema,
  sourceId: z.string().optional(),
  sourceLabel: z.string().optional(),
  priority: kanbanPrioritySchema.optional(),
  notes: z.string().optional(),
  url: z.string().optional(),
  completed: z.boolean(),
  overdue: z.boolean(),
});
export type ICourseDeadline = z.infer<typeof courseDeadlineSchema>;

export const courseListItemSchema = z.object({
  course: courseSchema,
  stats: courseStatsSchema,
  nextDeadline: courseDeadlineSchema.optional(),
});
export type ICourseListItem = z.infer<typeof courseListItemSchema>;

export const courseTimetableSummarySchema = z.object({
  _id: z.string(),
  title: z.string(),
  dayOfWeek: z.number(),
  startTime: z.string(),
  endTime: z.string(),
  place: z.string().optional(),
  color: timetableColorSchema,
  isActive: z.boolean(),
});
export type ICourseTimetableSummary = z.infer<
  typeof courseTimetableSummarySchema
>;

export const courseCalendarSummarySchema = z.object({
  _id: z.string(),
  title: z.string(),
  date: z.string(),
  calendarDate: z.string(),
  isAllDay: z.boolean(),
  kind: z.enum(["manual", "meeting", "flight", "holiday", "birthday"]),
  place: z.string().optional(),
  status: z.enum(["scheduled", "completed", "canceled"]),
});
export type ICourseCalendarSummary = z.infer<
  typeof courseCalendarSummarySchema
>;

export const courseKanbanBoardSummarySchema = z.object({
  _id: z.string(),
  title: z.string(),
  description: z.string().optional(),
  color: z.string().optional(),
  cardCount: z.number(),
  dueCardCount: z.number(),
});
export type ICourseKanbanBoardSummary = z.infer<
  typeof courseKanbanBoardSummarySchema
>;

export const courseKanbanCardSummarySchema = z.object({
  _id: z.string(),
  boardId: z.string(),
  columnId: z.string(),
  title: z.string(),
  description: z.string().optional(),
  labels: z.array(z.string()),
  priority: kanbanPrioritySchema,
  dueDate: z.string().optional(),
  completed: z.boolean().optional(),
});
export type ICourseKanbanCardSummary = z.infer<
  typeof courseKanbanCardSummarySchema
>;

export const courseNoteSummarySchema = z.object({
  _id: z.string(),
  title: z.string(),
  description: z.string().optional(),
  url: z.string().optional(),
  tags: z.array(z.string()),
  status: z.enum(["open", "archived"]),
  updatedAt: z.string(),
});
export type ICourseNoteSummary = z.infer<typeof courseNoteSummarySchema>;

export const coursePersonSummarySchema = z.object({
  _id: z.string(),
  name: z.string(),
  email: z.string().optional(),
  phone: z.string().optional(),
  website: z.string().optional(),
  notes: z.string(),
});
export type ICoursePersonSummary = z.infer<typeof coursePersonSummarySchema>;

export const courseResourceSummarySchema = z.object({
  _id: z.string(),
  name: z.string(),
  description: z.string(),
  url: z.string(),
  type: z.enum(["pi", "vps", "api", "service"]),
  isActive: z.boolean(),
  isPublic: z.boolean(),
});
export type ICourseResourceSummary = z.infer<
  typeof courseResourceSummarySchema
>;

export const courseReadingSummarySchema = z.object({
  _id: z.string(),
  title: z.string(),
  authorLine: z.string().optional(),
  readingStatus: paperReadingStatusSchema,
  currentPage: z.number().optional(),
  totalPages: z.number().optional(),
  dueAt: z.string().optional(),
  priority: kanbanPrioritySchema.optional(),
  hasPdf: z.boolean(),
  updatedAt: z.string(),
});
export type ICourseReadingSummary = z.infer<typeof courseReadingSummarySchema>;

export const courseEmailSummarySchema = z.object({
  _id: z.string(),
  triageId: z.string(),
  emailId: z.string(),
  /** Carried so the row sheet can fetch the body without a second lookup. */
  accountId: z.string(),
  subject: z.string(),
  from: z.string(),
  date: z.string(),
  category: triageCategorySchema,
  summary: z.string().optional(),
});
export type ICourseEmailSummary = z.infer<typeof courseEmailSummarySchema>;

/**
 * Related mail is paged rather than embedded in the course detail: a course
 * accrues triaged mail all semester, and the detail payload used to carry 50
 * summaries with prose on every open.
 */
export const courseEmailPageSchema = z.object({
  emails: z.array(courseEmailSummarySchema),
  total: z.number(),
});
export type ICourseEmailPage = z.infer<typeof courseEmailPageSchema>;

/**
 * Triage matched the course, so triage can be wrong about it. A relink moves
 * the rows to another course or drops the match entirely; `courseId: null` is
 * the unlink. Rows are only moved off the course they are currently on, so a
 * stale table cannot pull another course's mail across.
 */
export const courseEmailRelinkSchema = z.object({
  triageIds: z.array(z.string()).min(1),
  courseId: z.string().nullable(),
});
export type ICourseEmailRelink = z.infer<typeof courseEmailRelinkSchema>;

export const courseEmailRelinkResultSchema = z.object({
  moved: z.number(),
  courseId: z.string().nullable(),
  courseName: z.string().nullable(),
});
export type ICourseEmailRelinkResult = z.infer<
  typeof courseEmailRelinkResultSchema
>;

// All percentages are 0-100. Weight fields refer to grade weights (share of
// the final grade); projections are only computed from weighted grades.
export const courseGradeProjectionSchema = z.object({
  currentAverage: z.number().nullable(),
  gradedWeight: z.number().nullable(),
  remainingWeight: z.number().nullable(),
  bestCase: z.number().nullable(),
  worstCase: z.number().nullable(),
});
export type ICourseGradeProjection = z.infer<
  typeof courseGradeProjectionSchema
>;

export const courseDetailSchema = z.object({
  course: courseSchema,
  stats: courseStatsSchema,
  deadlines: z.array(courseDeadlineSchema),
  timetableEntries: z.array(courseTimetableSummarySchema),
  calendarEvents: z.array(courseCalendarSummarySchema),
  kanbanBoards: z.array(courseKanbanBoardSummarySchema),
  kanbanCards: z.array(courseKanbanCardSummarySchema),
  assignments: z.array(courseAssignmentSchema),
  notes: z.array(courseNoteSummarySchema),
  people: z.array(coursePersonSummarySchema),
  resources: z.array(courseResourceSummarySchema),
  readings: z.array(courseReadingSummarySchema),
  projection: courseGradeProjectionSchema,
});
export type ICourseDetail = z.infer<typeof courseDetailSchema>;

export const courseOptionSchema = z.object({
  _id: z.string(),
  title: z.string(),
  subtitle: z.string().optional(),
  meta: z.string().optional(),
});
export type ICourseOption = z.infer<typeof courseOptionSchema>;

export const courseOptionsSchema = z.object({
  timetableEntries: z.array(courseOptionSchema),
  calendarEvents: z.array(courseOptionSchema),
  kanbanBoards: z.array(courseOptionSchema),
  notes: z.array(courseOptionSchema),
  people: z.array(courseOptionSchema),
  resources: z.array(courseOptionSchema),
});
export type ICourseOptions = z.infer<typeof courseOptionsSchema>;

export const semesterDeadlineSchema = courseDeadlineSchema.extend({
  courseId: z.string(),
  courseName: z.string(),
  courseCode: z.string().optional(),
  courseColor: z.string().optional(),
});
export type ISemesterDeadline = z.infer<typeof semesterDeadlineSchema>;

export const semesterCourseStandingSchema = z.object({
  courseId: z.string(),
  name: z.string(),
  code: z.string().optional(),
  semester: z.string().optional(),
  color: z.string().optional(),
  gradeAverage: z.number().nullable(),
  projection: courseGradeProjectionSchema,
  openAssessments: z.number(),
  dueNext7Days: z.number(),
  overdue: z.number(),
  nextDeadline: semesterDeadlineSchema.optional(),
});
export type ISemesterCourseStanding = z.infer<
  typeof semesterCourseStandingSchema
>;

export const semesterScheduleClassSchema = z.object({
  courseId: z.string(),
  courseName: z.string(),
  courseColor: z.string().optional(),
  title: z.string(),
  startTime: z.string(),
  endTime: z.string(),
  place: z.string().optional(),
});
export type ISemesterScheduleClass = z.infer<
  typeof semesterScheduleClassSchema
>;

export const semesterScheduleDaySchema = z.object({
  date: z.string(),
  label: z.string(),
  isToday: z.boolean(),
  classes: z.array(semesterScheduleClassSchema),
  deadlineCount: z.number(),
});
export type ISemesterScheduleDay = z.infer<typeof semesterScheduleDaySchema>;

export const semesterOverviewStatsSchema = z.object({
  activeCourses: z.number(),
  openAssessments: z.number(),
  dueNext7Days: z.number(),
  overdue: z.number(),
  gradedAssessments: z.number(),
  semesterAverage: z.number().nullable(),
});
export type ISemesterOverviewStats = z.infer<
  typeof semesterOverviewStatsSchema
>;

export const semesterOverviewSchema = z.object({
  generatedAt: z.string(),
  stats: semesterOverviewStatsSchema,
  courses: z.array(semesterCourseStandingSchema),
  deadlines: z.array(semesterDeadlineSchema),
  week: z.array(semesterScheduleDaySchema),
});
export type ISemesterOverview = z.infer<typeof semesterOverviewSchema>;
