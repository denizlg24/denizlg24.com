import mongoose, { Schema } from "mongoose";
import { connectResourceDB } from "@/lib/mongodb-resource";

export interface IPingAgentMetrics {
  cpuUsagePercent: number | null;
  memoryUsagePercent: number | null;
  diskUsagePercent: number | null;
}

export interface IPingAgentService {
  enabled: boolean;
  nodeId: string;
  hmacSecret: {
    ciphertext: string;
    iv: string;
    authTag: string;
  } | null;
  lastCheckedAt: Date | null;
  lastStatus: "healthy" | "degraded" | "unreachable" | null;
  lastMetrics: IPingAgentMetrics | null;
}

export interface IPingResource {
  _id: mongoose.Types.ObjectId;
  name: string;
  url: string;
  isActive: boolean;
  isPublic: boolean;
  agentService: IPingAgentService;
  createdAt: Date;
  updatedAt: Date;
}

const PingAgentMetricsSchema = new Schema(
  {
    cpuUsagePercent: { type: Number, default: null },
    memoryUsagePercent: { type: Number, default: null },
    diskUsagePercent: { type: Number, default: null },
  },
  { _id: false },
);

const PingAgentServiceSchema = new Schema(
  {
    enabled: { type: Boolean, default: false },
    nodeId: { type: String, default: "" },
    hmacSecret: { type: Schema.Types.Mixed, default: null },
    lastCheckedAt: { type: Date, default: null },
    lastStatus: {
      type: String,
      enum: ["healthy", "degraded", "unreachable", null],
      default: null,
    },
    lastMetrics: { type: PingAgentMetricsSchema, default: null },
  },
  { _id: false },
);

const PingResourceSchema = new Schema(
  {
    name: { type: String, required: true },
    url: { type: String, required: true },
    isActive: { type: Boolean, default: true },
    isPublic: { type: Boolean, default: true },
    agentService: { type: PingAgentServiceSchema, default: () => ({}) },
  },
  { timestamps: true },
);

let cachedModel: mongoose.Model<IPingResource> | null = null;

export async function getPingResourceModel(): Promise<
  mongoose.Model<IPingResource>
> {
  if (cachedModel) return cachedModel;
  const conn = await connectResourceDB();
  cachedModel =
    (conn.models.PingResource as mongoose.Model<IPingResource>) ||
    conn.model<IPingResource>("PingResource", PingResourceSchema);
  return cachedModel;
}
