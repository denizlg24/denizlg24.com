import mongoose, { type Document, Schema } from "mongoose";

export type TriageCategory =
  | "spam"
  | "newsletter"
  | "promo"
  | "purchases"
  | "fyi"
  | "action-needed"
  | "scheduled";

export type TriageSuggestionStatus = "pending" | "accepted" | "dismissed";
export type TriagePriority = "none" | "low" | "medium" | "high" | "urgent";

export interface ITriageTaskSuggestion {
  _id: mongoose.Types.ObjectId;
  title: string;
  description?: string;
  priority: TriagePriority;
  dueDate?: Date;
  kanbanBoardId?: mongoose.Types.ObjectId;
  kanbanBoardTitle?: string;
  kanbanColumnId?: mongoose.Types.ObjectId;
  kanbanColumnTitle?: string;
  courseId?: mongoose.Types.ObjectId;
  courseName?: string;
  updatesCourseDeadlineId?: mongoose.Types.ObjectId;
  status: TriageSuggestionStatus;
  acceptedCardId?: mongoose.Types.ObjectId;
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
  confidence: number;
  summary?: string;
  matchedCourseId?: mongoose.Types.ObjectId;
  matchedCourseName?: string;
  suggestedTasks: ITriageTaskSuggestion[];
  suggestedEvents: ITriageEventSuggestion[];
  userStatus: "pending" | "reviewed" | "archived";
  modelUsed: string;
  triagedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface ILeanEmailTriage {
  _id: string;
  emailId: string;
  accountId: string;
  stage: "prefilter" | "full";
  category: TriageCategory;
  confidence: number;
  summary?: string;
  matchedCourseId?: string;
  matchedCourseName?: string;
  suggestedTasks: (Omit<
    ITriageTaskSuggestion,
    | "_id"
    | "acceptedCardId"
    | "kanbanBoardId"
    | "kanbanColumnId"
    | "courseId"
    | "updatesCourseDeadlineId"
  > & {
    _id: string;
    acceptedCardId?: string;
    kanbanBoardId?: string;
    kanbanColumnId?: string;
    courseId?: string;
    updatesCourseDeadlineId?: string;
  })[];
  suggestedEvents: (Omit<
    ITriageEventSuggestion,
    "_id" | "acceptedEventId" | "courseId" | "updatesCalendarEventId"
  > & {
    _id: string;
    acceptedEventId?: string;
    courseId?: string;
    updatesCalendarEventId?: string;
  })[];
  userStatus: "pending" | "reviewed" | "archived";
  modelUsed: string;
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
  kanbanBoardId: { type: Schema.Types.ObjectId, ref: "KanbanBoard" },
  kanbanBoardTitle: { type: String },
  kanbanColumnId: { type: Schema.Types.ObjectId, ref: "KanbanColumn" },
  kanbanColumnTitle: { type: String },
  courseId: { type: Schema.Types.ObjectId, ref: "Course" },
  courseName: { type: String },
  updatesCourseDeadlineId: { type: Schema.Types.ObjectId },
  status: {
    type: String,
    enum: ["pending", "accepted", "dismissed"],
    default: "pending",
  },
  acceptedCardId: { type: Schema.Types.ObjectId, ref: "KanbanCard" },
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
      enum: [
        "spam",
        "newsletter",
        "promo",
        "purchases",
        "fyi",
        "action-needed",
        "scheduled",
      ],
      required: true,
      index: true,
    },
    confidence: { type: Number, required: true, min: 0, max: 1 },
    summary: { type: String },
    matchedCourseId: {
      type: Schema.Types.ObjectId,
      ref: "Course",
      index: true,
    },
    matchedCourseName: { type: String },
    suggestedTasks: { type: [TaskSuggestionSchema], default: [] },
    suggestedEvents: { type: [EventSuggestionSchema], default: [] },
    userStatus: {
      type: String,
      enum: ["pending", "reviewed", "archived"],
      default: "pending",
      index: true,
    },
    modelUsed: { type: String, required: true },
    triagedAt: { type: Date, required: true, default: Date.now },
  },
  { timestamps: true },
);

EmailTriageSchema.index({ userStatus: 1, triagedAt: -1 });
EmailTriageSchema.index({ category: 1, userStatus: 1 });

export const EmailTriageModel: mongoose.Model<IEmailTriage> =
  mongoose.models.EmailTriage ||
  mongoose.model<IEmailTriage>("EmailTriage", EmailTriageSchema);
