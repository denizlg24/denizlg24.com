import mongoose, { type Document, Schema } from "mongoose";

export interface IPersonEdge extends Document {
  from: mongoose.Types.ObjectId;
  to: mongoose.Types.ObjectId;
  strength: number;
  reason?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface ILeanPersonEdge {
  _id: string;
  from: string;
  to: string;
  strength: number;
  reason?: string;
  createdAt: Date;
  updatedAt: Date;
}

const PersonEdgeSchema = new Schema<IPersonEdge>(
  {
    from: {
      type: Schema.Types.ObjectId,
      ref: "Person",
      required: true,
      index: true,
    },
    to: {
      type: Schema.Types.ObjectId,
      ref: "Person",
      required: true,
      index: true,
    },
    strength: { type: Number, default: 1, min: 0, max: 1 },
    reason: { type: String },
  },
  { timestamps: true },
);

PersonEdgeSchema.pre("validate", function canonicalize() {
  const from = String(this.from);
  const to = String(this.to);
  if (from > to) {
    this.from = new mongoose.Types.ObjectId(to);
    this.to = new mongoose.Types.ObjectId(from);
  }
});

PersonEdgeSchema.index({ from: 1, to: 1 }, { unique: true });

export const PersonEdge: mongoose.Model<IPersonEdge> =
  (mongoose.models.PersonEdge as mongoose.Model<IPersonEdge> | undefined) ||
  mongoose.model<IPersonEdge>("PersonEdge", PersonEdgeSchema);
