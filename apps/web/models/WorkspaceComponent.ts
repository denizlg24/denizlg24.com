import type {
  ComponentBinding,
  ComponentKind,
  ComponentProp,
  UiNode,
} from "@repo/schemas";
import mongoose from "mongoose";

/** A custom UI element in the component library; `component` blocks place it. */
export interface IWorkspaceComponent {
  _id: mongoose.Types.ObjectId;
  name: string;
  description: string;
  icon: string | null;
  kind: ComponentKind;
  spec: UiNode | null;
  html: string;
  css: string;
  js: string;
  bindings: ComponentBinding[];
  props: ComponentProp[];
  height: number;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}

const workspaceComponentSchema = new mongoose.Schema<IWorkspaceComponent>(
  {
    name: { type: String, required: true },
    description: { type: String, default: "" },
    icon: { type: String, default: null },
    kind: { type: String, required: true },
    spec: { type: mongoose.Schema.Types.Mixed, default: null },
    html: { type: String, default: "" },
    css: { type: String, default: "" },
    js: { type: String, default: "" },
    bindings: { type: mongoose.Schema.Types.Mixed, default: [] },
    props: { type: mongoose.Schema.Types.Mixed, default: [] },
    height: { type: Number, default: 240 },
    createdBy: { type: String, required: true },
  },
  { timestamps: true, minimize: false, versionKey: false },
);

export const WorkspaceComponentModel: mongoose.Model<IWorkspaceComponent> =
  mongoose.models.WorkspaceComponent ||
  mongoose.model<IWorkspaceComponent>(
    "WorkspaceComponent",
    workspaceComponentSchema,
  );
