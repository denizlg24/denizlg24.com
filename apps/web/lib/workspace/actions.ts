import {
  THIS_PAGE,
  type WorkflowAction,
  type WorkflowActionResult,
} from "@repo/schemas";
import {
  markdownToBlocks,
  WorkspaceMarkdownError,
} from "@repo/utils/workspace-markdown";
import {
  fillTemplate,
  type TemplateClock,
} from "@repo/utils/workspace-templates";
import { countBlocks, findBlock } from "@repo/utils/workspace-tree";
import {
  type WorkspaceCaller,
  WorkspaceError,
  type WorkspaceService,
} from "./service";

/*
 * What a button or a trigger does: an ordered list of typed actions, each
 * run through the service that owns its records — never an HTTP call back
 * into this app. Each action is atomic on its own (one revision, one card,
 * one event) and a failure is reported in its result without stopping the
 * ones after it; there is no rollback across actions.
 */

/** Blocks one append may write, counting nested ones. */
export const APPEND_BLOCKS_MAX = 100;

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** A refusal worth showing as is; anything else is reported generically. */
export class ActionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ActionError";
  }
}

export interface ActionRunContext {
  /** The button that was pressed; null when a trigger runs the actions. */
  host: { pageId: string; blockId: string } | null;
  caller: WorkspaceCaller;
  clock: TemplateClock;
  timeZone: string;
  /** A person pressed it: `open` hands its URL back instead of skipping. */
  interactive: boolean;
  /** The triggering event's payload, for `{{event.<field>}}`. */
  event?: Record<string, string>;
}

export interface CardInput {
  boardId: string;
  columnId: string;
  title: string;
  description?: string;
  /** `YYYY-MM-DD`, in the owner's time zone. */
  dueDate?: string;
}

export interface EventInput {
  title: string;
  /** `YYYY-MM-DD` */
  date: string;
  /** `HH:MM` local; absent is all day. */
  time?: string;
  durationMinutes: number;
  place?: string;
}

export interface ActionDeps {
  workspace: WorkspaceService;
  createCard: (input: CardInput) => Promise<{ id: string }>;
  createEvent: (input: EventInput, timeZone: string) => Promise<{ id: string }>;
  newId: () => string;
}

function errorMessage(error: unknown): string {
  if (error instanceof ActionError || error instanceof WorkspaceError) {
    return error.message;
  }
  if (error instanceof WorkspaceMarkdownError) return error.message;
  console.error("Workflow action failed:", error);
  return "The action failed";
}

export async function runWorkflowActions(
  actions: readonly WorkflowAction[],
  context: ActionRunContext,
  deps: ActionDeps,
): Promise<WorkflowActionResult[]> {
  let hostTitle: string | null = null;
  const pageTitle = async () => {
    if (hostTitle !== null) return hostTitle;
    hostTitle = context.host
      ? (await deps.workspace.getPage(context.host.pageId)).title
      : "";
    return hostTitle;
  };
  const fill = async (text: string) =>
    fillTemplate(text, {
      ...context.clock,
      pageTitle: await pageTitle(),
      inputs: {},
      ...(context.event ? { event: context.event } : {}),
    });
  const fillAll = async (inputs: Record<string, string>) =>
    Object.fromEntries(
      await Promise.all(
        Object.entries(inputs).map(
          async ([name, value]) => [name, await fill(value)] as const,
        ),
      ),
    );
  const page = (target: string): string => {
    if (target !== THIS_PAGE) return target;
    if (!context.host) {
      throw new ActionError("$this names no page outside a button");
    }
    return context.host.pageId;
  };
  const date = async (value: string, field: string) => {
    const filled = (await fill(value)).trim();
    if (!DATE.test(filled)) {
      throw new ActionError(`${field} must be YYYY-MM-DD, not "${filled}"`);
    }
    return filled;
  };

  const run = async (
    action: WorkflowAction,
  ): Promise<Omit<WorkflowActionResult, "index" | "kind" | "ok">> => {
    switch (action.kind) {
      case "create-page": {
        const created = await deps.workspace.instantiateTemplate(
          action.templateId,
          {
            parentId: action.parentId === null ? null : page(action.parentId),
            ...(action.title !== undefined
              ? { title: await fill(action.title) }
              : {}),
            inputs: await fillAll(action.inputs),
          },
          context.caller,
          context.clock,
        );
        return { pageId: created.id };
      }
      case "append-blocks": {
        const blocks = markdownToBlocks(await fill(action.markdown), {
          newId: deps.newId,
          lenient: true,
        });
        if (countBlocks(blocks) > APPEND_BLOCKS_MAX) {
          throw new ActionError(
            `At most ${APPEND_BLOCKS_MAX} blocks per append`,
          );
        }
        const pageId = page(action.pageId);
        await deps.workspace.insertBlocks(pageId, blocks, {}, context.caller);
        return { pageId, blockIds: blocks.map((block) => block.id) };
      }
      case "insert-template": {
        if (!context.host) {
          throw new ActionError("insert-template needs the button's page");
        }
        const host = await deps.workspace.getPage(context.host.pageId);
        const location = findBlock(host.blocks, context.host.blockId);
        const before = new Set(host.blocks.map((block) => block.id));
        const after = await deps.workspace.insertTemplate(
          action.templateId,
          {
            pageId: host.id,
            ...(location?.parentId ? { parentId: location.parentId } : {}),
            ...(location ? { after: location.block.id } : {}),
            inputs: await fillAll(action.inputs),
          },
          context.caller,
          context.clock,
        );
        return {
          pageId: host.id,
          blockIds: location?.parentId
            ? []
            : after.blocks
                .map((block) => block.id)
                .filter((id) => !before.has(id)),
        };
      }
      case "create-card": {
        const card = await deps.createCard({
          boardId: action.boardId,
          columnId: action.columnId,
          title: await fill(action.title),
          ...(action.description !== undefined
            ? { description: await fill(action.description) }
            : {}),
          ...(action.dueDate !== undefined
            ? { dueDate: await date(action.dueDate, "dueDate") }
            : {}),
        });
        return { cardId: card.id };
      }
      case "create-event": {
        const event = await deps.createEvent(
          {
            title: await fill(action.title),
            date: await date(action.date, "date"),
            ...(action.time ? { time: action.time } : {}),
            durationMinutes: action.durationMinutes,
            ...(action.place !== undefined
              ? { place: await fill(action.place) }
              : {}),
          },
          context.timeZone,
        );
        return { eventId: event.id };
      }
      case "set-todo": {
        const pageId = page(action.pageId);
        await deps.workspace.setTodo(
          pageId,
          action.blockId,
          action.checked,
          context.caller,
        );
        return { pageId, blockIds: [action.blockId] };
      }
      case "open":
        return context.interactive
          ? { url: await fill(action.url) }
          : { skipped: true };
    }
  };

  const results: WorkflowActionResult[] = [];
  for (const [index, action] of actions.entries()) {
    try {
      results.push({
        index,
        kind: action.kind,
        ok: true,
        ...(await run(action)),
      });
    } catch (error) {
      results.push({
        index,
        kind: action.kind,
        ok: false,
        error: errorMessage(error),
      });
    }
  }
  return results;
}
