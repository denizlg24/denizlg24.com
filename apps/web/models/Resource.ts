import mongoose, { type Document, Schema, type Types } from "mongoose";

export interface ICapability {
  _id: mongoose.Types.ObjectId;
  type: string;
  label: string;
  baseUrl: string;
  config: Record<string, unknown>;
  isActive: boolean;
}

export interface ILeanCapability {
  _id: string;
  type: string;
  label: string;
  baseUrl: string;
  config: Record<string, unknown>;
  isActive: boolean;
}

export interface IAgentServiceMetrics {
  cpuUsagePercent: number | null;
  memoryUsagePercent: number | null;
  diskUsagePercent: number | null;
}

export interface IAgentService {
  enabled: boolean;
  nodeId: string;
  hmacSecret: {
    ciphertext: string;
    iv: string;
    authTag: string;
  } | null;
  lastCheckedAt: Date | null;
  lastStatus: "healthy" | "degraded" | "unreachable" | null;
  lastMetrics: IAgentServiceMetrics | null;
}

export interface IResource extends Document {
  name: string;
  description: string;
  url: string;
  type: "pi" | "vps" | "api" | "service";
  isActive: boolean;
  isPublic: boolean;
  agentService: IAgentService;
  capabilities: Types.DocumentArray<ICapability>;
  createdAt: Date;
  updatedAt: Date;
}

export interface ILeanResource {
  _id: string;
  name: string;
  description: string;
  url: string;
  type: "pi" | "vps" | "api" | "service";
  isActive: boolean;
  isPublic: boolean;
  agentService: IAgentService;
  capabilities: ILeanCapability[];
  createdAt: string;
  updatedAt: string;
}

const AgentServiceMetricsSchema = new Schema(
  {
    cpuUsagePercent: { type: Number, default: null },
    memoryUsagePercent: { type: Number, default: null },
    diskUsagePercent: { type: Number, default: null },
  },
  { _id: false },
);

const AgentServiceSchema = new Schema(
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
    lastMetrics: { type: AgentServiceMetricsSchema, default: null },
  },
  { _id: false },
);

const CapabilitySchema = new Schema({
  type: { type: String, required: true },
  label: { type: String, required: true },
  baseUrl: { type: String, required: true },
  config: { type: Schema.Types.Mixed, required: true },
  isActive: { type: Boolean, default: true },
});

const ResourceSchema: Schema = new Schema(
  {
    name: { type: String, required: true },
    description: { type: String, default: "" },
    url: { type: String, required: true },
    type: {
      type: String,
      enum: ["pi", "vps", "api", "service"],
      required: true,
    },
    isActive: { type: Boolean, default: true },
    isPublic: { type: Boolean, default: true },
    agentService: { type: AgentServiceSchema, default: () => ({}) },
    capabilities: [CapabilitySchema],
  },
  { timestamps: true },
);

export const Resource: mongoose.Model<IResource> =
  mongoose.models.Resource ||
  mongoose.model<IResource>("Resource", ResourceSchema);
