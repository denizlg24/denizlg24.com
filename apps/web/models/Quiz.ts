import mongoose, { Schema } from "mongoose";

export interface IQuiz {
  notebookId: mongoose.Types.ObjectId;
  title: string;
  questionIds: mongoose.Types.ObjectId[];
  settings: { shuffle: boolean; timeLimitSec?: number };
  attemptCount: number;
  bestScore?: number;
  lastScore?: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface ILeanQuiz extends IQuiz {
  _id: mongoose.Types.ObjectId;
}

const QuizSchema = new Schema<IQuiz>(
  {
    notebookId: {
      type: Schema.Types.ObjectId,
      ref: "StudyNotebook",
      required: true,
      index: true,
    },
    title: { type: String, required: true, trim: true, maxlength: 200 },
    questionIds: {
      type: [{ type: Schema.Types.ObjectId, ref: "StudyQuestion" }],
      default: [],
    },
    settings: {
      type: new Schema(
        {
          shuffle: { type: Boolean, default: true },
          timeLimitSec: { type: Number },
        },
        { _id: false },
      ),
      default: () => ({ shuffle: true }),
    },
    attemptCount: { type: Number, default: 0 },
    bestScore: { type: Number },
    lastScore: { type: Number },
  },
  { timestamps: true },
);

export const Quiz: mongoose.Model<IQuiz> =
  (mongoose.models.StudyQuiz as mongoose.Model<IQuiz> | undefined) ||
  mongoose.model<IQuiz>("StudyQuiz", QuizSchema, "study_quizzes");
