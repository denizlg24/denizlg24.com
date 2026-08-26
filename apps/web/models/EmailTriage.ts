import { TRIAGE_CATEGORIES, type TriageCategory } from "@repo/schemas";
import mongoose, { type Document, Schema } from "mongoose";

export type { TriageCategory };

export type TriageSuggestionStatus = "pending" | "accepted" | "dismissed";
export type TriagePriority = "none" | "low" | "medium" | "high" | "urgent";
export type TriageCourseAssignmentType =
  | "assignment"
  | "exam"
  | "quiz"
  | "project"
  | "lab"
  | "reading";

/**
 * Where an accepted course task lands. `assessment` is the only value that
 * reaches the gradebook; `deadline` is dated coursework with no mark, and
 * `task` is board work. Extraction defaults to `deadline` when it cannot tell,
 * because a deadline promoted later costs one click while an assessment has
 * already moved the course average by the time anyone notices.
 */
export type TriageCourseWorkKind = "assessment" | "deadline" | "task";

export interface ITriageTaskSuggestion {
  _id: mongoose.Types.ObjectId;
  title: string;
  description?: string;
  priority: TriagePriority;
  dueDate?: Date;
  dueHasTime?: boolean;
  kanbanBoardId?: mongoose.Types.ObjectId;
  kanbanBoardTitle?: string;
  kanbanColumnId?: mongoose.Types.ObjectId;
  kanbanColumnTitle?: string;
  courseId?: mongoose.Types.ObjectId;
  courseName?: string;
  updatesCourseDeadlineId?: mongoose.Types.ObjectId;
  courseWorkKind?: TriageCourseWorkKind;
  assignmentType?: TriageCourseAssignmentType;
  /** Share of the final grade, 0-100, when the source states it. */
  gradeWeight?: number;
  routedToCourseBoard?: boolean;
  status: TriageSuggestionStatus;
  acceptedCardId?: mongoose.Types.ObjectId;
  acceptedAssignmentId?: mongoose.Types.ObjectId;
}

export interface ITriageEventSuggestion {
  _id: mongoose.Types.ObjectId;
  title: string;
  date: Date;
  place?: string;
  courseId?: mongoose.Types.ObjectId;
  courseName?: string;
  updatesCalendarEventId?: mongoose.Types.ObjectId;
  status: TriageSuggestionStatus;
  acceptedEventId?: mongoose.Types.ObjectId;
}

export interface IEmailTriage extends Document {
  emailId: mongoose.Types.ObjectId;
  accountId: mongoose.Types.ObjectId;
  stage: "prefilter" | "full";
  category: TriageCategory;
  modelCategory?: TriageCategory;
  /**
   * The label as triage produced it, snapshotted the first time a human
   * overrides `category`. Absent means nobody has corrected this row, so
   * `category` is still the model's own answer. Dataset building reads this to
   * tell a weak LLM label apart from a verified human one.
   */
  llmCategory?: TriageCategory;
  confidence: number;
  classificationThreshold?: number;
  classificationProbabilities?: Record<TriageCategory, number>;
  reviewRequired: boolean;
  reviewReason?: string;
  summary?: string;
  matchedCourseId?: mongoose.Types.ObjectId;
  matchedCourseName?: string;
  attachmentTextUsed: boolean;
  attachmentTextSources: string[];
  suggestedTasks: ITriageTaskSuggestion[];
  suggestedEvents: ITriageEventSuggestion[];
  userStatus: "pending" | "reviewed" | "archived";
  modelUsed: string;
  extractionModelUsed?: string;
  derivationStatus?: "pending" | "done" | "failed";
  derivedAt?: Date;
  derivationError?: string;
  triagedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const TaskSuggestionSchema = new Schema<ITriageTaskSuggestion>({
  title: { type: String, required: true },
  description: { type: String },
  priority: {
    type: String,
    enum: ["none", "low", "medium", "high", "urgent"],
    default: "none",
  },
  dueDate: { type: Date },
  dueHasTime: { type: Boolean },
  kanbanBoardId: { type: Schema.Types.ObjectId, ref: "KanbanBoard" },
  kanbanBoardTitle: { type: String },
  kanbanColumnId: { type: Schema.Types.ObjectId, ref: "KanbanColumn" },
  kanbanColumnTitle: { type: String },
  courseId: { type: Schema.Types.ObjectId, ref: "Course" },
  courseName: { type: String },
  updatesCourseDeadlineId: { type: Schema.Types.ObjectId },
  courseWorkKind: {
    type: String,
    enum: ["assessment", "deadline", "task"],
  },
  assignmentType: {
    type: String,
    enum: ["assignment", "exam", "quiz", "project", "lab", "reading"],
  },
  gradeWeight: { type: Number, min: 0, max: 100 },
  routedToCourseBoard: { type: Boolean },
  status: {
    type: String,
    enum: ["pending", "accepted", "dismissed"],
    default: "pending",
  },
  acceptedCardId: { type: Schema.Types.ObjectId, ref: "KanbanCard" },
  acceptedAssignmentId: {
    type: Schema.Types.ObjectId,
    ref: "CourseAssignment",
  },
});

const EventSuggestionSchema = new Schema<ITriageEventSuggestion>({
  title: { type: String, required: true },
  date: { type: Date, required: true },
  place: { type: String },
  courseId: { type: Schema.Types.ObjectId, ref: "Course" },
  courseName: { type: String },
  updatesCalendarEventId: { type: Schema.Types.ObjectId, ref: "CalendarEvent" },
  status: {
    type: String,
    enum: ["pending", "accepted", "dismissed"],
    default: "pending",
  },
  acceptedEventId: { type: Schema.Types.ObjectId, ref: "CalendarEvent" },
});

const EmailTriageSchema = new Schema<IEmailTriage>(
  {
    emailId: {
      type: Schema.Types.ObjectId,
      ref: "Email",
      required: true,
      unique: true,
    },
    accountId: {
      type: Schema.Types.ObjectId,
      ref: "EmailAccount",
      required: true,
      index: true,
    },
    stage: {
      type: String,
      enum: ["prefilter", "full"],
      required: true,
    },
    category: {
      type: String,
      enum: TRIAGE_CATEGORIES,
      required: true,
      index: true,
    },
    modelCategory: {
      type: String,
      enum: TRIAGE_CATEGORIES,
    },
    llmCategory: {
      type: String,
      enum: TRIAGE_CATEGORIES,
    },
    confidence: { type: Number, required: true, min: 0, max: 1 },
    classificationThreshold: { type: Number, min: 0, max: 1 },
    classificationProbabilities: { type: Schema.Types.Mixed },
    reviewRequired: {
      type: Boolean,
      required: true,
      default: false,
      index: true,
    },
    reviewReason: { type: String },
    summary: { type: String },
    matchedCourseId: {
      type: Schema.Types.ObjectId,
      ref: "Course",
      index: true,
    },
    matchedCourseName: { type: String },
    attachmentTextUsed: { type: Boolean, default: false },
    attachmentTextSources: { type: [String], default: [] },
    suggestedTasks: { type: [TaskSuggestionSchema], default: [] },
    suggestedEvents: { type: [EventSuggestionSchema], default: [] },
    userStatus: {
      type: String,
      enum: ["pending", "reviewed", "archived"],
      default: "pending",
      index: true,
    },
    modelUsed: { type: String, required: true },
    extractionModelUsed: { type: String },
    derivationStatus: {
      type: String,
      enum: ["pending", "done", "failed"],
    },
    derivedAt: { type: Date },
    derivationError: { type: String },
    triagedAt: { type: Date, required: true, default: Date.now },
  },
  { timestamps: true },
);

EmailTriageSchema.index({ userStatus: 1, triagedAt: -1 });
EmailTriageSchema.index({ category: 1, userStatus: 1 });
EmailTriageSchema.index({ reviewRequired: 1, userStatus: 1, triagedAt: -1 });
// Covers the filter-tab badge aggregation, which groups on exactly these three
// fields and so can run as an index scan instead of a collection scan.
EmailTriageSchema.index({ userStatus: 1, reviewRequired: 1, category: 1 });
// The course Mail tab pages on this exact shape: one course, newest first,
// optionally narrowed to a category.
EmailTriageSchema.index({ matchedCourseId: 1, triagedAt: -1 });
EmailTriageSchema.index({ matchedCourseId: 1, category: 1, triagedAt: -1 });

export const EmailTriageModel: mongoose.Model<IEmailTriage> =
  mongoose.models.EmailTriage ||
  mongoose.model<IEmailTriage>("EmailTriage", EmailTriageSchema);
