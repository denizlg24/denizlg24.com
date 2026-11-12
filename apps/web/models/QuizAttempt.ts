import type { QuizResponse } from "@repo/schemas";
import mongoose, { Schema } from "mongoose";

export interface IQuizAttemptAnswer {
  questionId: mongoose.Types.ObjectId;
  response: QuizResponse | null;
  correct: boolean;
  credit: number;
  feedback?: string;
}

export interface IQuizAttempt {
  quizId: mongoose.Types.ObjectId;
  notebookId: mongoose.Types.ObjectId;
  answers: IQuizAttemptAnswer[];
  score: number;
  startedAt: Date;
  finishedAt: Date;
  durationMs: number;
}

export interface ILeanQuizAttempt extends IQuizAttempt {
  _id: mongoose.Types.ObjectId;
}

const AnswerSchema = new Schema<IQuizAttemptAnswer>(
  {
    questionId: { type: Schema.Types.ObjectId, required: true },
    response: { type: Schema.Types.Mixed, default: null },
    correct: { type: Boolean, required: true },
    credit: { type: Number, required: true },
    feedback: { type: String },
  },
  { _id: false },
);

const QuizAttemptSchema = new Schema<IQuizAttempt>(
  {
    quizId: {
      type: Schema.Types.ObjectId,
      ref: "StudyQuiz",
      required: true,
      index: true,
    },
    notebookId: {
      type: Schema.Types.ObjectId,
      ref: "StudyNotebook",
      required: true,
      index: true,
    },
    answers: { type: [AnswerSchema], default: [] },
    score: { type: Number, required: true },
    startedAt: { type: Date, required: true },
    finishedAt: { type: Date, required: true },
    durationMs: { type: Number, required: true },
  },
  { timestamps: false, minimize: false },
);

export const QuizAttemptModel: mongoose.Model<IQuizAttempt> =
  (mongoose.models.StudyQuizAttempt as
    | mongoose.Model<IQuizAttempt>
    | undefined) ||
  mongoose.model<IQuizAttempt>(
    "StudyQuizAttempt",
    QuizAttemptSchema,
    "study_quiz_attempts",
  );
