import mongoose, { type Document, Schema } from "mongoose";

export type VoiceNoteTranscriptionStatus =
  | "untranscribed"
  | "queued"
  | "transcribing"
  | "transcribed"
  | "failed";

export interface IVoiceNoteTranscriptSegment {
  text: string;
  startSecond: number;
  endSecond: number;
}

/**
 * Where the current title came from. Only a `placeholder` is overwritten once
 * the transcript arrives — a title the owner typed is never regenerated.
 */
export type VoiceNoteTitleSource = "placeholder" | "generated" | "manual";

export type VoiceNoteContextKind = "calendar-event" | "timetable-entry";
export type VoiceNoteContextSource = "auto" | "manual";

export interface IVoiceNoteContextRef {
  kind: VoiceNoteContextKind;
  id: mongoose.Types.ObjectId;
}

export interface IVoiceNote extends Document {
  title: string;
  titleSource: VoiceNoteTitleSource;
  storageKey: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  durationMs?: number;
  waveform: number[];
  source: "recording" | "upload" | "agent";
  noteIds: mongoose.Types.ObjectId[];
  /** When recording started. Absent for uploads that did not say. */
  recordedAt?: Date;
  tags: string[];
  context?: IVoiceNoteContextRef;
  contextSource?: VoiceNoteContextSource;
  transcription: {
    status: VoiceNoteTranscriptionStatus;
    text?: string;
    language?: string;
    model?: string;
    segments?: IVoiceNoteTranscriptSegment[];
    requestVersion: number;
    /** Transcription attempts that have failed; caps unattended retries. */
    failedAttempts?: number;
    /** Pieces of a split recording transcribed so far, while it runs. */
    progress?: { completed: number; total: number };
    requestedAt?: Date;
    startedAt?: Date;
    completedAt?: Date;
    error?: string;
  };
  createdAt: Date;
  updatedAt: Date;
}

export interface ILeanVoiceNote {
  _id: mongoose.Types.ObjectId | string;
  title: string;
  titleSource?: VoiceNoteTitleSource;
  storageKey: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  durationMs?: number;
  waveform: number[];
  source: "recording" | "upload" | "agent";
  noteIds: Array<mongoose.Types.ObjectId | string>;
  recordedAt?: Date;
  tags?: string[];
  context?: IVoiceNoteContextRef;
  contextSource?: VoiceNoteContextSource;
  transcription: {
    status: VoiceNoteTranscriptionStatus;
    text?: string;
    language?: string;
    model?: string;
    segments?: IVoiceNoteTranscriptSegment[];
    requestVersion: number;
    /** Transcription attempts that have failed; caps unattended retries. */
    failedAttempts?: number;
    /** Pieces of a split recording transcribed so far, while it runs. */
    progress?: { completed: number; total: number };
    requestedAt?: Date;
    startedAt?: Date;
    completedAt?: Date;
    error?: string;
  };
  createdAt: Date;
  updatedAt: Date;
}

const TranscriptSegmentSchema = new Schema<IVoiceNoteTranscriptSegment>(
  {
    text: { type: String, required: true },
    startSecond: { type: Number, required: true, min: 0 },
    endSecond: { type: Number, required: true, min: 0 },
  },
  { _id: false },
);

const VoiceNoteSchema = new Schema<IVoiceNote>(
  {
    title: { type: String, required: true, trim: true, maxlength: 300 },
    titleSource: {
      type: String,
      enum: ["placeholder", "generated", "manual"],
      default: "manual",
    },
    storageKey: { type: String, required: true, unique: true },
    filename: { type: String, required: true, maxlength: 500 },
    mimeType: { type: String, required: true, maxlength: 200 },
    sizeBytes: { type: Number, required: true, min: 1 },
    durationMs: { type: Number, min: 0 },
    waveform: {
      type: [{ type: Number, min: 0, max: 1 }],
      default: [],
    },
    source: {
      type: String,
      enum: ["recording", "upload", "agent"],
      default: "recording",
    },
    noteIds: {
      type: [{ type: Schema.Types.ObjectId, ref: "KnowledgeNote" }],
      default: [],
    },
    recordedAt: { type: Date },
    tags: {
      type: [{ type: String, trim: true, maxlength: 40 }],
      default: [],
    },
    context: {
      type: new Schema<IVoiceNoteContextRef>(
        {
          kind: {
            type: String,
            enum: ["calendar-event", "timetable-entry"],
            required: true,
          },
          id: { type: Schema.Types.ObjectId, required: true },
        },
        { _id: false },
      ),
    },
    contextSource: { type: String, enum: ["auto", "manual"] },
    transcription: {
      status: {
        type: String,
        enum: [
          "untranscribed",
          "queued",
          "transcribing",
          "transcribed",
          "failed",
        ],
        default: "untranscribed",
        index: true,
      },
      text: { type: String },
      language: { type: String, maxlength: 50 },
      model: { type: String, maxlength: 200 },
      segments: { type: [TranscriptSegmentSchema] },
      requestVersion: { type: Number, default: 0, min: 0 },
      failedAttempts: { type: Number, default: 0, min: 0 },
      progress: {
        completed: { type: Number, min: 0 },
        total: { type: Number, min: 0 },
      },
      requestedAt: { type: Date },
      startedAt: { type: Date },
      completedAt: { type: Date },
      error: { type: String, maxlength: 4_096 },
    },
  },
  { collection: "voice_notes", timestamps: true, minimize: false },
);

VoiceNoteSchema.index({ createdAt: -1 });
VoiceNoteSchema.index({ recordedAt: -1 });
VoiceNoteSchema.index({ tags: 1 });
VoiceNoteSchema.index({ "context.id": 1 });
VoiceNoteSchema.index({ noteIds: 1, createdAt: -1 });
VoiceNoteSchema.index({ title: "text", "transcription.text": "text" });

export const VoiceNote: mongoose.Model<IVoiceNote> =
  (mongoose.models.VoiceNote as mongoose.Model<IVoiceNote> | undefined) ||
  mongoose.model<IVoiceNote>("VoiceNote", VoiceNoteSchema);
