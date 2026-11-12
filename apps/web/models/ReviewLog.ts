import type { FsrsState, ReviewRating } from "@repo/schemas";
import mongoose, { Schema } from "mongoose";

export interface IReviewLog {
  cardId: mongoose.Types.ObjectId;
  deckId: mongoose.Types.ObjectId;
  notebookId: mongoose.Types.ObjectId;
  rating: ReviewRating;
  /** State before the rating; `new` marks a card's first review. */
  stateBefore: FsrsState;
  due: Date;
  scheduledDays: number;
  durationMs?: number;
  reviewedAt: Date;
}

const ReviewLogSchema = new Schema<IReviewLog>(
  {
    cardId: { type: Schema.Types.ObjectId, required: true },
    deckId: { type: Schema.Types.ObjectId, required: true },
    notebookId: { type: Schema.Types.ObjectId, required: true },
    rating: {
      type: String,
      enum: ["again", "hard", "good", "easy"],
      required: true,
    },
    stateBefore: {
      type: String,
      enum: ["new", "learning", "review", "relearning"],
      required: true,
    },
    due: { type: Date, required: true },
    scheduledDays: { type: Number, required: true },
    durationMs: { type: Number },
    reviewedAt: { type: Date, required: true },
  },
  { timestamps: false },
);

ReviewLogSchema.index({ notebookId: 1, reviewedAt: -1 });
ReviewLogSchema.index({ cardId: 1, reviewedAt: -1 });

export const ReviewLog: mongoose.Model<IReviewLog> =
  (mongoose.models.StudyReviewLog as mongoose.Model<IReviewLog> | undefined) ||
  mongoose.model<IReviewLog>(
    "StudyReviewLog",
    ReviewLogSchema,
    "study_review_logs",
  );
