import mongoose, { Schema } from "mongoose";

export interface ITriageRunLease {
  _id: "singleton";
  owner?: string;
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const TriageRunLeaseSchema = new Schema<ITriageRunLease>(
  {
    _id: { type: String, default: "singleton" },
    owner: { type: String },
    expiresAt: { type: Date, required: true, default: () => new Date(0) },
  },
  { timestamps: true },
);

export const TriageRunLeaseModel: mongoose.Model<ITriageRunLease> =
  mongoose.models.TriageRunLease ||
  mongoose.model<ITriageRunLease>("TriageRunLease", TriageRunLeaseSchema);
