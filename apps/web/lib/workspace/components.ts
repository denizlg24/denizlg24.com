import {
  type ComponentActionRequest,
  type ComponentInput,
  type ComponentPatch,
  componentActionRequestSchema,
  componentInputSchema,
  type UiNode,
  type WorkflowActionResult,
  type WorkspaceComponent,
  type WorkspaceComponentSummary,
  workspaceComponentSchema,
} from "@repo/schemas";
import { findBlock } from "@repo/utils/workspace-tree";
import { Types } from "mongoose";
import {
  type IWorkspaceComponent,
  WorkspaceComponentModel,
} from "@/models/WorkspaceComponent";
import { type WorkspaceCaller, WorkspaceError } from "./service";

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

function findNode(node: UiNode, id: string): UiNode | null {
  if (node.id === id) return node;
  for (const child of node.children ?? []) {
    const hit = findNode(child, id);
    if (hit) return hit;
  }
  return null;
}

/**
 * Presses a button node of a component placed on a page. The actions come
 * from the stored component, never the request: the client only says which
 * node was pressed and the `actionVars` it filled, which reach the actions
 * as `{{event.<name>}}`. The placing block is the host, so `$this` is its page.
 */
export async function pressComponentAction(
  input: ComponentActionRequest,
  caller: WorkspaceCaller,
): Promise<WorkflowActionResult[]> {
  const request = componentActionRequestSchema.parse(input);
  // Loaded on use, like events.ts does: the workspace singleton and the action
  // services pull in half the app, and a static import here made every
  // importer of the component library load them for real.
  const [
    { workspaceService },
    { runWorkflowActions },
    { workflowActionDeps },
    { getAppTimeZone },
    { templateClock },
  ] = await Promise.all([
    import("./index"),
    import("./actions"),
    import("./workflow-deps"),
    import("@/lib/timezone"),
    import("@repo/utils/workspace-templates"),
  ]);
  const page = await workspaceService.getPage(request.pageId);
  const block = findBlock(page.blocks, request.blockId)?.block;
  if (block?.type !== "component" || !block.componentId) {
    throw new WorkspaceError(
      404,
      "NOT_COMPONENT",
      `No component block ${request.blockId} on page ${request.pageId}`,
    );
  }
  const component = await getComponent(block.componentId);
  const node = component.spec ? findNode(component.spec, request.nodeId) : null;
  if (!node?.actions?.length) {
    throw new WorkspaceError(
      404,
      "NO_ACTIONS",
      `Node ${request.nodeId} runs no actions`,
    );
  }
  const declared = new Set(Object.keys(node.actionVars ?? {}));
  const event = Object.fromEntries(
    Object.entries(request.vars).filter(([name]) => declared.has(name)),
  );
  const timeZone = await getAppTimeZone();
  return runWorkflowActions(
    node.actions,
    {
      host: { pageId: page.id, blockId: block.id },
      caller,
      clock: templateClock(new Date(), timeZone),
      timeZone,
      interactive: !caller.agent,
      event,
    },
    workflowActionDeps(timeZone),
  );
}
