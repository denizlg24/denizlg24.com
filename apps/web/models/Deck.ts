import mongoose, { Schema } from "mongoose";

export interface IDeck {
  notebookId: mongoose.Types.ObjectId;
  title: string;
  description?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface ILeanDeck extends IDeck {
  _id: mongoose.Types.ObjectId;
}

const DeckSchema = new Schema<IDeck>(
  {
    notebookId: {
      type: Schema.Types.ObjectId,
      ref: "StudyNotebook",
      required: true,
      index: true,
    },
    title: { type: String, required: true, trim: true, maxlength: 200 },
    description: { type: String, maxlength: 2_000 },
  },
  { timestamps: true },
);

export const Deck: mongoose.Model<IDeck> =
  (mongoose.models.StudyDeck as mongoose.Model<IDeck> | undefined) ||
  mongoose.model<IDeck>("StudyDeck", DeckSchema, "study_decks");
