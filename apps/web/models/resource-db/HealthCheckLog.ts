import mongoose, { Schema, type Types } from "mongoose";
import { connectResourceDB } from "@/lib/mongodb-resource";

export interface IHealthCheckLog {
  resourceId: Types.ObjectId;
  status: number | null;
  responseTimeMs: number | null;
  isHealthy: boolean;
  error?: string;
  checkedAt: Date;
}

const HealthCheckLogSchema = new Schema({
  resourceId: {
    type: Schema.Types.ObjectId,
    ref: "PingResource",
    required: true,
  },
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

let cachedModel: mongoose.Model<IHealthCheckLog> | null = null;

export async function getHealthCheckLogModel(): Promise<
  mongoose.Model<IHealthCheckLog>
> {
  if (cachedModel) return cachedModel;
  const conn = await connectResourceDB();
  cachedModel =
    (conn.models.HealthCheckLog as mongoose.Model<IHealthCheckLog>) ||
    conn.model<IHealthCheckLog>("HealthCheckLog", HealthCheckLogSchema);
  return cachedModel;
}
