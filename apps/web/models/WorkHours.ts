import mongoose, { type Document, Schema } from "mongoose";

export interface IWorkJob extends Document {
  name: string;
  hourlyRateMinor: number;
  currency: string;
  breaksPaid: boolean;
  expectedWeeklyHours?: number;
  timezone: string;
  status: "active" | "archived";
  createdAt: Date;
  updatedAt: Date;
}

const workJobSchema = new Schema<IWorkJob>(
  {
    name: { type: String, required: true },
    hourlyRateMinor: {
      type: Number,
      required: true,
      min: 0,
      validate: Number.isSafeInteger,
    },
    currency: { type: String, required: true, match: /^[A-Z]{3}$/ },
    breaksPaid: { type: Boolean, default: false },
    expectedWeeklyHours: { type: Number, min: 0, max: 168 },
    timezone: { type: String, required: true, default: "Europe/Copenhagen" },
    status: {
      type: String,
      enum: ["active", "archived"],
      default: "active",
    },
  },
  { collection: "work_jobs", timestamps: true },
);

export interface IWorkBreak {
  start: Date;
  end?: Date;
}

export interface IWorkSession extends Document {
  jobId: mongoose.Types.ObjectId;
  start: Date;
  end?: Date;
  breaks: IWorkBreak[];
  note?: string;
  /** The job-local day the shift started on; what periods and totals key on. */
  day: string;
  /** "open" exactly while `end` is unset; unset otherwise. */
  openKey?: "open";
  createdAt: Date;
  updatedAt: Date;
}

const workBreakSchema = new Schema<IWorkBreak>(
  {
    start: { type: Date, required: true },
    end: { type: Date },
  },
  { _id: false },
);

const workSessionSchema = new Schema<IWorkSession>(
  {
    jobId: { type: Schema.Types.ObjectId, ref: "WorkJob", required: true },
    start: { type: Date, required: true },
    end: { type: Date },
    breaks: { type: [workBreakSchema], default: [] },
    note: { type: String },
    day: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
    openKey: { type: String, enum: ["open"] },
  },
  { collection: "work_sessions", timestamps: true },
);

workSessionSchema.index({ jobId: 1, day: -1 });
workSessionSchema.index({ start: -1 });
// At most one open shift, across every job: you cannot be at two jobs at once,
// and a double tap on "in" must not open a second one. A partial index cannot
// filter on `$exists: false`, hence the marker field.
workSessionSchema.index({ openKey: 1 }, { unique: true, sparse: true });

export const WorkJob: mongoose.Model<IWorkJob> =
  (mongoose.models.WorkJob as mongoose.Model<IWorkJob> | undefined) ||
  mongoose.model<IWorkJob>("WorkJob", workJobSchema);

export const WorkSession: mongoose.Model<IWorkSession> =
  (mongoose.models.WorkSession as mongoose.Model<IWorkSession> | undefined) ||
  mongoose.model<IWorkSession>("WorkSession", workSessionSchema);
