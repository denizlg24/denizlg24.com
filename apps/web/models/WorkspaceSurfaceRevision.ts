import type { SurfaceChrome } from "@repo/schemas";
import mongoose from "mongoose";

/** One version of a surface's code, as a full snapshot. */
export interface IWorkspaceSurfaceRevision {
  _id: mongoose.Types.ObjectId;
  surfaceId: string;
  rev: number;
  actor: string;
  at: Date;
  changed: string[];
  name: string;
  description: string;
  icon: string | null;
  head: string;
  html: string;
  css: string;
  js: string;
  chrome: SurfaceChrome;
}

const workspaceSurfaceRevisionSchema =
  new mongoose.Schema<IWorkspaceSurfaceRevision>(
    {
      surfaceId: { type: String, required: true },
      rev: { type: Number, required: true },
      actor: { type: String, required: true },
      at: { type: Date, required: true },
      changed: { type: [String], default: [] },
      name: { type: String, required: true },
      description: { type: String, default: "" },
      icon: { type: String, default: null },
      head: { type: String, default: "" },
      html: { type: String, default: "" },
      css: { type: String, default: "" },
      js: { type: String, default: "" },
      chrome: { type: String, default: "none" },
    },
    { minimize: false, versionKey: false },
  );

workspaceSurfaceRevisionSchema.index(
  { surfaceId: 1, rev: 1 },
  { unique: true },
);

export const WorkspaceSurfaceRevisionModel: mongoose.Model<IWorkspaceSurfaceRevision> =
  mongoose.models.WorkspaceSurfaceRevision ||
  mongoose.model<IWorkspaceSurfaceRevision>(
    "WorkspaceSurfaceRevision",
    workspaceSurfaceRevisionSchema,
  );
