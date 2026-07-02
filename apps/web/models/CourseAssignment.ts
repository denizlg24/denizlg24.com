import mongoose, { type Document, Schema } from "mongoose";

export type CourseAssignmentType =
  | "assignment"
  | "exam"
  | "quiz"
  | "project"
  | "lab"
  | "reading"
  | "other";

export type CourseAssignmentStatus =
  | "planned"
  | "in-progress"
  | "submitted"
  | "graded"
  | "archived";

export interface ICourseAssignmentLink {
  _id: mongoose.Types.ObjectId;
  label: string;
  url: string;
}

export interface ICourseAssignmentFile {
  _id: mongoose.Types.ObjectId;
  name: string;
  url: string;
  mimeType?: string;
  size?: number;
}

export interface ICourseAssignmentGrade {
  score?: number;
  maxScore?: number;
  letter?: string;
  weight?: number;
  gradedAt?: Date;
  notes?: string;
}

export interface ICourseAssignment extends Document {
  courseId: mongoose.Types.ObjectId;
  title: string;
  type: CourseAssignmentType;
  status: CourseAssignmentStatus;
  dueAt?: Date;
  submittedAt?: Date;
  notes?: string;
  links: mongoose.Types.DocumentArray<ICourseAssignmentLink>;
  files: mongoose.Types.DocumentArray<ICourseAssignmentFile>;
  grade?: ICourseAssignmentGrade;
  createdAt: Date;
  updatedAt: Date;
}

const AssignmentLinkSchema = new Schema<ICourseAssignmentLink>({
  label: { type: String, required: true, trim: true },
  url: { type: String, required: true, trim: true },
});

const AssignmentFileSchema = new Schema<ICourseAssignmentFile>({
  name: { type: String, required: true, trim: true },
  url: { type: String, required: true, trim: true },
  mimeType: { type: String, trim: true },
  size: { type: Number, min: 0 },
});

const AssignmentGradeSchema = new Schema<ICourseAssignmentGrade>(
  {
    score: { type: Number, min: 0 },
    maxScore: { type: Number, min: 0 },
    letter: { type: String, trim: true },
    weight: { type: Number, min: 0 },
    gradedAt: { type: Date },
    notes: { type: String, trim: true },
  },
  { _id: false },
);

const CourseAssignmentSchema = new Schema<ICourseAssignment>(
  {
    courseId: {
      type: Schema.Types.ObjectId,
      ref: "Course",
      required: true,
      index: true,
    },
    title: { type: String, required: true, trim: true, index: true },
    type: {
      type: String,
      enum: [
        "assignment",
        "exam",
        "quiz",
        "project",
        "lab",
        "reading",
        "other",
      ],
      default: "assignment",
      index: true,
    },
    status: {
      type: String,
      enum: ["planned", "in-progress", "submitted", "graded", "archived"],
      default: "planned",
      index: true,
    },
    dueAt: { type: Date, index: true },
    submittedAt: { type: Date },
    notes: { type: String, trim: true },
    links: { type: [AssignmentLinkSchema], default: [] },
    files: { type: [AssignmentFileSchema], default: [] },
    grade: { type: AssignmentGradeSchema },
  },
  { timestamps: true },
);

CourseAssignmentSchema.index({ courseId: 1, dueAt: 1 });
CourseAssignmentSchema.index({ courseId: 1, status: 1 });

export const CourseAssignment: mongoose.Model<ICourseAssignment> =
  (mongoose.models.CourseAssignment as
    | mongoose.Model<ICourseAssignment>
    | undefined) ||
  mongoose.model<ICourseAssignment>("CourseAssignment", CourseAssignmentSchema);
