import type { FsrsState, KnowledgeSourceKey } from "@repo/schemas";
import mongoose, { Schema } from "mongoose";

export interface IStudySourceRef {
  chunkId: string;
  sourceKey: KnowledgeSourceKey;
  contentHash: string;
}

export interface IFlashcardFsrs {
  due: Date;
  stability: number;
  difficulty: number;
  elapsedDays: number;
  scheduledDays: number;
  learningSteps: number;
  reps: number;
  lapses: number;
  state: FsrsState;
  lastReview?: Date;
}

export interface IFlashcard {
  deckId: mongoose.Types.ObjectId;
  notebookId: mongoose.Types.ObjectId;
  front: string;
  back: string;
  sources: IStudySourceRef[];
  suspended: boolean;
  fsrs: IFlashcardFsrs;
  createdAt: Date;
  updatedAt: Date;
}

export interface ILeanFlashcard extends IFlashcard {
  _id: mongoose.Types.ObjectId;
}

export const StudySourceRefSchema = new Schema<IStudySourceRef>(
  {
    chunkId: { type: String, required: true },
    sourceKey: { type: String, required: true },
    contentHash: { type: String, required: true },
  },
  { _id: false },
);

const FsrsSchema = new Schema<IFlashcardFsrs>(
  {
    due: { type: Date, required: true },
    stability: { type: Number, required: true },
    difficulty: { type: Number, required: true },
    elapsedDays: { type: Number, required: true },
    scheduledDays: { type: Number, required: true },
    learningSteps: { type: Number, required: true },
    reps: { type: Number, required: true },
    lapses: { type: Number, required: true },
    state: {
      type: String,
      enum: ["new", "learning", "review", "relearning"],
      required: true,
    },
    lastReview: { type: Date },
  },
  { _id: false },
);

const FlashcardSchema = new Schema<IFlashcard>(
  {
    deckId: {
      type: Schema.Types.ObjectId,
      ref: "StudyDeck",
      required: true,
      index: true,
    },
    notebookId: {
      type: Schema.Types.ObjectId,
      ref: "StudyNotebook",
      required: true,
    },
    front: { type: String, required: true, maxlength: 4_000 },
    back: { type: String, required: true, maxlength: 8_000 },
    sources: { type: [StudySourceRefSchema], default: [] },
    suspended: { type: Boolean, default: false },
    fsrs: { type: FsrsSchema, required: true },
  },
  { timestamps: true },
);

FlashcardSchema.index({ notebookId: 1, "fsrs.due": 1 });
FlashcardSchema.index({ deckId: 1, "fsrs.due": 1 });

export const Flashcard: mongoose.Model<IFlashcard> =
  (mongoose.models.StudyFlashcard as mongoose.Model<IFlashcard> | undefined) ||
  mongoose.model<IFlashcard>(
    "StudyFlashcard",
    FlashcardSchema,
    "study_flashcards",
  );
