import mongoose, { Schema, type Types } from "mongoose";
import { connectResourceDB } from "@/lib/mongodb-resource";

export interface ISubResourceHttpCheck {
  type: "http";
  url: string;
  expectStatus: number | null;
  expectJsonPath: string | null;
  expectEquals: string | null;
}

export interface ISubResourceTcpCheck {
  type: "tcp";
  host: string;
  port: number;
}

export type SubResourceCheck = ISubResourceHttpCheck | ISubResourceTcpCheck;

export interface ISubResource {
  _id: Types.ObjectId;
  parentResourceId: Types.ObjectId;
  name: string;
  description: string;
  isActive: boolean;
  isPublic: boolean;
  check: SubResourceCheck;
  lastCheckedAt: Date | null;
  lastStatus: "healthy" | "unhealthy" | null;
  lastResponseTimeMs: number | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ILeanSubResource {
  _id: string;
  parentResourceId: string;
  name: string;
  description: string;
  isActive: boolean;
  isPublic: boolean;
  check: SubResourceCheck;
  lastCheckedAt: string | null;
  lastStatus: "healthy" | "unhealthy" | null;
  lastResponseTimeMs: number | null;
  createdAt: string;
  updatedAt: string;
}

const SubResourceCheckSchema = new Schema(
  {
    type: { type: String, enum: ["http", "tcp"], required: true },
    url: { type: String },
    expectStatus: { type: Number, default: null },
    expectJsonPath: { type: String, default: null },
    expectEquals: { type: String, default: null },
    host: { type: String },
    port: { type: Number },
  },
  { _id: false },
);

const SubResourceSchema = new Schema(
  {
    parentResourceId: {
      type: Schema.Types.ObjectId,
      ref: "PingResource",
      required: true,
      index: true,
    },
    name: { type: String, required: true },
    description: { type: String, default: "" },
    isActive: { type: Boolean, default: true },
    isPublic: { type: Boolean, default: true },
    check: { type: SubResourceCheckSchema, required: true },
    lastCheckedAt: { type: Date, default: null },
    lastStatus: {
      type: String,
      enum: ["healthy", "unhealthy", null],
      default: null,
    },
    lastResponseTimeMs: { type: Number, default: null },
  },
  { timestamps: true },
);

let cachedModel: mongoose.Model<ISubResource> | null = null;

export async function getSubResourceModel(): Promise<
  mongoose.Model<ISubResource>
> {
  if (cachedModel) return cachedModel;
  const conn = await connectResourceDB();
  cachedModel =
    (conn.models.SubResource as mongoose.Model<ISubResource>) ||
    conn.model<ISubResource>("SubResource", SubResourceSchema);
  return cachedModel;
}
