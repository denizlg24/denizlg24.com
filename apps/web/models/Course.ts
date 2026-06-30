import mongoose, { type Document, Schema } from "mongoose";

export type CourseStatus = "active" | "archived";

export interface ICourseLink {
  _id: mongoose.Types.ObjectId;
  label: string;
  url: string;
  icon?: string;
}

export interface ICourseCustomField {
  _id: mongoose.Types.ObjectId;
  label: string;
  value: string;
}

export interface ICourseManualDeadline {
  _id: mongoose.Types.ObjectId;
  title: string;
  dueAt: Date;
  notes?: string;
  url?: string;
  completed: boolean;
}

export interface ICourse extends Document {
  name: string;
  code?: string;
  semester?: string;
  description?: string;
  homepageUrl?: string;
  instructorName?: string;
  location?: string;
  color?: string;
  status: CourseStatus;
  startsOn?: Date;
  endsOn?: Date;
  links: mongoose.Types.DocumentArray<ICourseLink>;
  customFields: mongoose.Types.DocumentArray<ICourseCustomField>;
  manualDeadlines: mongoose.Types.DocumentArray<ICourseManualDeadline>;
  timetableEntryIds: mongoose.Types.ObjectId[];
  calendarEventIds: mongoose.Types.ObjectId[];
  kanbanBoardIds: mongoose.Types.ObjectId[];
  noteIds: mongoose.Types.ObjectId[];
  personIds: mongoose.Types.ObjectId[];
  resourceIds: mongoose.Types.ObjectId[];
  createdAt: Date;
  updatedAt: Date;
}

const LinkSchema = new Schema<ICourseLink>({
  label: { type: String, required: true, trim: true },
  url: { type: String, required: true, trim: true },
  icon: { type: String, trim: true },
});

const CustomFieldSchema = new Schema<ICourseCustomField>({
  label: { type: String, required: true, trim: true },
  value: { type: String, required: true, trim: true },
});

const ManualDeadlineSchema = new Schema<ICourseManualDeadline>({
  title: { type: String, required: true, trim: true },
  dueAt: { type: Date, required: true, index: true },
  notes: { type: String, trim: true },
  url: { type: String, trim: true },
  completed: { type: Boolean, default: false, index: true },
});

const objectIdArray = (ref: string) => [
  {
    type: Schema.Types.ObjectId,
    ref,
    index: true,
  },
];

const CourseSchema = new Schema<ICourse>(
  {
    name: { type: String, required: true, trim: true, index: true },
    code: { type: String, trim: true, index: true },
    semester: { type: String, trim: true, index: true },
    description: { type: String, trim: true },
    homepageUrl: { type: String, trim: true },
    instructorName: { type: String, trim: true },
    location: { type: String, trim: true },
    color: { type: String, trim: true },
    status: {
      type: String,
      enum: ["active", "archived"],
      default: "active",
      index: true,
    },
    startsOn: { type: Date },
    endsOn: { type: Date },
    links: { type: [LinkSchema], default: [] },
    customFields: { type: [CustomFieldSchema], default: [] },
    manualDeadlines: { type: [ManualDeadlineSchema], default: [] },
    timetableEntryIds: { type: objectIdArray("TimetableEntry"), default: [] },
    calendarEventIds: { type: objectIdArray("CalendarEvent"), default: [] },
    kanbanBoardIds: { type: objectIdArray("KanbanBoard"), default: [] },
    noteIds: { type: objectIdArray("KnowledgeNote"), default: [] },
    personIds: { type: objectIdArray("Person"), default: [] },
    resourceIds: { type: objectIdArray("Resource"), default: [] },
  },
  { timestamps: true },
);

CourseSchema.index({ status: 1, semester: 1, name: 1 });

export const Course: mongoose.Model<ICourse> =
  (mongoose.models.Course as mongoose.Model<ICourse> | undefined) ||
  mongoose.model<ICourse>("Course", CourseSchema);
