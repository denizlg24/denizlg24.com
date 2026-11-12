import type { QuestionBody } from "@repo/schemas";
import mongoose, { Schema } from "mongoose";
import { type IStudySourceRef, StudySourceRefSchema } from "./Flashcard";

export interface IStudyQuestion {
  notebookId: mongoose.Types.ObjectId;
  prompt: string;
  body: QuestionBody;
  explanation?: string;
  difficulty?: "easy" | "medium" | "hard";
  sources: IStudySourceRef[];
  wrongCount: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface ILeanStudyQuestion extends IStudyQuestion {
  _id: mongoose.Types.ObjectId;
}

const StudyQuestionSchema = new Schema<IStudyQuestion>(
  {
    notebookId: {
      type: Schema.Types.ObjectId,
      ref: "StudyNotebook",
      required: true,
      index: true,
    },
    prompt: { type: String, required: true, maxlength: 4_000 },
    body: { type: Schema.Types.Mixed, required: true },
    explanation: { type: String, maxlength: 4_000 },
    difficulty: { type: String, enum: ["easy", "medium", "hard"] },
    sources: { type: [StudySourceRefSchema], default: [] },
    wrongCount: { type: Number, default: 0 },
  },
  { timestamps: true, minimize: false },
);

export const StudyQuestion: mongoose.Model<IStudyQuestion> =
  (mongoose.models.StudyQuestion as
    | mongoose.Model<IStudyQuestion>
    | undefined) ||
  mongoose.model<IStudyQuestion>(
    "StudyQuestion",
    StudyQuestionSchema,
    "study_questions",
  );
