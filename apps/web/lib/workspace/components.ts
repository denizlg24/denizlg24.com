import {
  type ComponentInput,
  type ComponentPatch,
  componentInputSchema,
  type WorkspaceComponent,
  type WorkspaceComponentSummary,
  workspaceComponentSchema,
} from "@repo/schemas";
import { Types } from "mongoose";
import {
  type IWorkspaceComponent,
  WorkspaceComponentModel,
} from "@/models/WorkspaceComponent";
import { WorkspaceError } from "./service";

function componentOf(doc: IWorkspaceComponent): WorkspaceComponent | null {
  const parsed = workspaceComponentSchema.safeParse({
    id: doc._id.toString(),
    name: doc.name,
    description: doc.description,
    icon: doc.icon,
    kind: doc.kind,
    spec: doc.spec,
    html: doc.html,
    css: doc.css,
    js: doc.js,
    bindings: doc.bindings,
    props: doc.props,
    height: doc.height,
    createdBy: doc.createdBy,
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
  });
  return parsed.success ? parsed.data : null;
}

function notFound(id: string): WorkspaceError {
  return new WorkspaceError(404, "NOT_FOUND", `Component ${id} not found`);
}

export async function listComponents(): Promise<WorkspaceComponentSummary[]> {
  const docs = await WorkspaceComponentModel.find()
    .sort({ name: 1 })
    .lean<IWorkspaceComponent[]>()
    .exec();
  return docs
    .map(componentOf)
    .filter((c): c is WorkspaceComponent => c !== null)
    .map(({ id, name, description, icon, kind, createdBy, updatedAt }) => ({
      id,
      name,
      description,
      icon,
      kind,
      createdBy,
      updatedAt,
    }));
}

export async function getComponent(id: string): Promise<WorkspaceComponent> {
  if (!Types.ObjectId.isValid(id)) throw notFound(id);
  const doc = await WorkspaceComponentModel.findById(id)
    .lean<IWorkspaceComponent>()
    .exec();
  const component = doc ? componentOf(doc) : null;
  if (!component) throw notFound(id);
  return component;
}

export async function createComponent(
  input: ComponentInput,
  createdBy: string,
): Promise<WorkspaceComponent> {
  const parsed = componentInputSchema.parse(input);
  const doc = await WorkspaceComponentModel.create({ ...parsed, createdBy });
  const component = componentOf(doc.toObject());
  if (!component) throw new Error("Stored component failed validation");
  return component;
}

export async function updateComponent(
  id: string,
  patch: ComponentPatch,
): Promise<WorkspaceComponent> {
  const current = await getComponent(id);
  const {
    id: _id,
    createdBy: _createdBy,
    createdAt: _createdAt,
    updatedAt: _updatedAt,
    ...fields
  } = current;
  const merged = componentInputSchema.safeParse({ ...fields, ...patch });
  if (!merged.success) {
    throw new WorkspaceError(400, "INVALID_INPUT", "Invalid component", {
      issues: merged.error.issues.slice(0, 5),
    });
  }
  await WorkspaceComponentModel.updateOne(
    { _id: id },
    { $set: merged.data },
  ).exec();
  return getComponent(id);
}

export async function deleteComponent(id: string): Promise<void> {
  await getComponent(id);
  await WorkspaceComponentModel.deleteOne({ _id: id }).exec();
}
