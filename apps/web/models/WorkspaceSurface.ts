import type {
  SurfaceAsset,
  SurfaceChrome,
  SurfaceError,
  SurfaceMount,
} from "@repo/schemas";
import mongoose from "mongoose";

/** A whole-window app the owner or an agent wrote; see `workspace-surfaces`. */
export interface IWorkspaceSurface {
  _id: mongoose.Types.ObjectId;
  name: string;
  description: string;
  icon: string | null;
  head: string;
  html: string;
  css: string;
  js: string;
  chrome: SurfaceChrome;
  mount: SurfaceMount;
  assets: SurfaceAsset[];
  state: Record<string, unknown>;
  frameErrors: SurfaceError[];
  rev: number;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}

const workspaceSurfaceSchema = new mongoose.Schema<IWorkspaceSurface>(
  {
    name: { type: String, required: true },
    description: { type: String, default: "" },
    icon: { type: String, default: null },
    head: { type: String, default: "" },
    html: { type: String, default: "" },
    css: { type: String, default: "" },
    js: { type: String, default: "" },
    chrome: { type: String, default: "none" },
    mount: { type: mongoose.Schema.Types.Mixed, default: { kind: "none" } },
    assets: { type: mongoose.Schema.Types.Mixed, default: [] },
    state: { type: mongoose.Schema.Types.Mixed, default: {} },
    frameErrors: { type: mongoose.Schema.Types.Mixed, default: [] },
    rev: { type: Number, default: 1 },
    createdBy: { type: String, required: true },
  },
  { timestamps: true, minimize: false, versionKey: false },
);

export const WorkspaceSurfaceModel: mongoose.Model<IWorkspaceSurface> =
  mongoose.models.WorkspaceSurface ||
  mongoose.model<IWorkspaceSurface>("WorkspaceSurface", workspaceSurfaceSchema);
