import mongoose, { Schema, type Types } from "mongoose";

export interface IHealthCheckLog {
  resourceId: Types.ObjectId;
  status: number | null;
  responseTimeMs: number | null;
  isHealthy: boolean;
  error?: string;
  checkedAt: Date;
}

const HealthCheckLogSchema = new Schema({
  resourceId: { type: Schema.Types.ObjectId, ref: "Resource", required: true },
  status: { type: Number, default: null },
  responseTimeMs: { type: Number, default: null },
  isHealthy: { type: Boolean, required: true },
  error: { type: String },
  checkedAt: { type: Date, required: true, default: () => new Date() },
});

HealthCheckLogSchema.index({ resourceId: 1, checkedAt: -1 });
HealthCheckLogSchema.index(
  { checkedAt: 1 },
  { expireAfterSeconds: 35 * 24 * 60 * 60 },
);

export const HealthCheckLog: mongoose.Model<IHealthCheckLog> =
  mongoose.models.HealthCheckLog ||
  mongoose.model<IHealthCheckLog>("HealthCheckLog", HealthCheckLogSchema);
