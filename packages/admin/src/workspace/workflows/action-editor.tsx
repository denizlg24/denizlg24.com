"use client";

import {
  type Block,
  type BlockOf,
  kanbanBoardSchema,
  kanbanColumnSchema,
  type TemplateInputs,
  THIS_PAGE,
  WORKFLOW_ACTION_KINDS,
  WORKFLOW_ACTIONS_MAX,
  type WorkflowAction,
  type WorkflowActionKind,
  type WorkspaceTemplateSummary,
} from "@repo/schemas";
import { Button } from "@repo/ui/button";
import { FormField, FormGrid } from "@repo/ui/form-dialog";
import { Input } from "@repo/ui/input";
import { NativeSelect, NativeSelectOption } from "@repo/ui/native-select";
import { Switch } from "@repo/ui/switch";
import { Textarea } from "@repo/ui/textarea";
import { plainText } from "@repo/utils/workspace-rich-text";
import { walkBlocks } from "@repo/utils/workspace-tree";
import { ArrowDown, ArrowUp, Plus, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { z } from "zod";
import type { AdminClient } from "../../client";
import { useAdmin } from "../../provider";
import { pageTitle } from "../refs";
import { useWorkspaceStore } from "../store";
import { fetchTemplates } from "../template-picker";

export const ACTION_LABELS: Record<WorkflowActionKind, string> = {
  "create-page": "New page from template",
  "append-blocks": "Append to page",
  "insert-template": "Insert template",
  "create-card": "Create card",
  "create-event": "Create event",
  "set-todo": "Set to-do",
  open: "Open",
};

export function newAction(kind: WorkflowActionKind): WorkflowAction {
  switch (kind) {
    case "create-page":
      return { kind, templateId: "", parentId: null, inputs: {} };
    case "append-blocks":
      return { kind, pageId: THIS_PAGE, markdown: "- {{time}} " };
    case "insert-template":
      return { kind, templateId: "", inputs: {} };
    case "create-card":
      return { kind, boardId: "", columnId: "", title: "" };
    case "create-event":
      return { kind, title: "", date: "{{date}}", durationMinutes: 60 };
    case "set-todo":
      return { kind, pageId: THIS_PAGE, blockId: "", checked: true };
    case "open":
      return { kind, url: "" };
  }
}

// --- shared lookups -------------------------------------------------------------

const boardsSchema = z.object({
  boards: z.array(kanbanBoardSchema.pick({ _id: true, title: true })),
});
const columnsSchema = z.object({
  columns: z.array(
    kanbanColumnSchema.pick({ _id: true, title: true, isDoneColumn: true }),
  ),
});

function useLoaded<T>(
  load: (client: AdminClient) => Promise<T>,
  key: string,
): T | null {
  const { client } = useAdmin();
  const [value, setValue] = useState<T | null>(null);
  useEffect(() => {
    let live = true;
    setValue(null);
    load(client)
      .then((next) => live && setValue(next))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [client, key]);
  return value;
}

function useTemplates(): WorkspaceTemplateSummary[] {
  return useLoaded(fetchTemplates, "templates") ?? [];
}

function useBoards() {
  return (
    useLoaded(
      async (client) =>
        boardsSchema.parse(await client.get("kanban/boards")).boards,
      "boards",
    ) ?? []
  );
}

function useColumns(boardId: string) {
  return (
    useLoaded(
      async (client) =>
        boardId
          ? columnsSchema.parse(
              await client.get(
                `kanban/boards/${encodeURIComponent(boardId)}/columns`,
              ),
            ).columns
          : [],
      `columns:${boardId}`,
    ) ?? []
  );
}

/** Live pages that can hold blocks: no templates, no trash. */
function usePageChoices() {
  const pages = useWorkspaceStore((s) => s.workspace.pages);
  return useMemo(
    () =>
      Object.values(pages)
        .filter((page) => !page.deletedAt && !page.template)
        .sort((a, b) => pageTitle(a).localeCompare(pageTitle(b))),
    [pages],
  );
}

// --- fields ---------------------------------------------------------------------

function PageSelect({
  id,
  value,
  onChange,
  allowThisPage,
  allowNone,
}: {
  id: string;
  value: string | null;
  onChange: (value: string | null) => void;
  allowThisPage: boolean;
  allowNone?: string;
}) {
  const pages = usePageChoices();
  return (
    <NativeSelect
      id={id}
      className="w-full"
      value={value ?? ""}
      onChange={(event) => onChange(event.target.value || null)}
    >
      {allowNone ? (
        <NativeSelectOption value="">{allowNone}</NativeSelectOption>
      ) : null}
      {allowThisPage ? (
        <NativeSelectOption value={THIS_PAGE}>This page</NativeSelectOption>
      ) : null}
      {pages.map((page) => (
        <NativeSelectOption key={page.id} value={page.id}>
          {pageTitle(page)}
        </NativeSelectOption>
      ))}
    </NativeSelect>
  );
}

function TemplateFields({
  prefix,
  templateId,
  inputs,
  onChange,
}: {
  prefix: string;
  templateId: string;
  inputs: TemplateInputs;
  onChange: (patch: { templateId?: string; inputs?: TemplateInputs }) => void;
}) {
  const templates = useTemplates();
  const template = templates.find((t) => t.id === templateId);
  return (
    <>
      <FormField label="Template" htmlFor={`${prefix}-template`}>
        <NativeSelect
          id={`${prefix}-template`}
          className="w-full"
          value={templateId}
          onChange={(event) =>
            onChange({ templateId: event.target.value, inputs: {} })
          }
        >
          <NativeSelectOption value="">—</NativeSelectOption>
          {templates.map((t) => (
            <NativeSelectOption key={t.id} value={t.id}>
              {t.title || "Untitled"}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </FormField>
      {template?.inputs.map((name) => (
        <FormField key={name} label={name} htmlFor={`${prefix}-input-${name}`}>
          <Input
            id={`${prefix}-input-${name}`}
            value={inputs[name] ?? ""}
            onChange={(event) =>
              onChange({ inputs: { ...inputs, [name]: event.target.value } })
            }
          />
        </FormField>
      ))}
    </>
  );
}

function todosOf(blocks: readonly Block[]) {
  const todos: BlockOf<"todo">[] = [];
  walkBlocks(blocks, (block) => {
    if (block.type === "todo") todos.push(block);
  });
  return todos;
}

function ActionFields({
  prefix,
  action,
  onChange,
  hostPageId,
}: {
  prefix: string;
  action: WorkflowAction;
  onChange: (action: WorkflowAction) => void;
  hostPageId: string | null;
}) {
  const allowThisPage = hostPageId !== null;
  const boards = useBoards();
  const columns = useColumns(
    action.kind === "create-card" ? action.boardId : "",
  );
  const todoPageId =
    action.kind === "set-todo"
      ? action.pageId === THIS_PAGE
        ? hostPageId
        : action.pageId
      : null;
  const todoBlocks = useWorkspaceStore((s) =>
    todoPageId ? s.workspace.pages[todoPageId]?.blocks : undefined,
  );
  const ensurePage = useWorkspaceStore((s) => s.ensurePage);
  useEffect(() => {
    if (todoPageId) void ensurePage(todoPageId);
  }, [ensurePage, todoPageId]);

  switch (action.kind) {
    case "create-page":
      return (
        <FormGrid>
          <TemplateFields
            prefix={prefix}
            templateId={action.templateId}
            inputs={action.inputs}
            onChange={(patch) => onChange({ ...action, ...patch })}
          />
          <FormField label="Inside" htmlFor={`${prefix}-parent`}>
            <PageSelect
              id={`${prefix}-parent`}
              value={action.parentId}
              allowThisPage={allowThisPage}
              allowNone="Top level"
              onChange={(parentId) => onChange({ ...action, parentId })}
            />
          </FormField>
          <FormField label="Title" htmlFor={`${prefix}-title`}>
            <Input
              id={`${prefix}-title`}
              value={action.title ?? ""}
              onChange={(event) => {
                const { title: _title, ...rest } = action;
                onChange(
                  event.target.value
                    ? { ...rest, title: event.target.value }
                    : rest,
                );
              }}
            />
          </FormField>
        </FormGrid>
      );
    case "append-blocks":
      return (
        <FormGrid>
          <FormField label="Page" htmlFor={`${prefix}-page`}>
            <PageSelect
              id={`${prefix}-page`}
              value={action.pageId}
              allowThisPage={allowThisPage}
              onChange={(pageId) =>
                onChange({ ...action, pageId: pageId ?? THIS_PAGE })
              }
            />
          </FormField>
          <FormField
            label="Markdown"
            htmlFor={`${prefix}-markdown`}
            className="sm:col-span-2"
          >
            <Textarea
              id={`${prefix}-markdown`}
              value={action.markdown}
              onChange={(event) =>
                onChange({ ...action, markdown: event.target.value })
              }
              className="font-mono text-xs"
            />
          </FormField>
        </FormGrid>
      );
    case "insert-template":
      return (
        <FormGrid>
          <TemplateFields
            prefix={prefix}
            templateId={action.templateId}
            inputs={action.inputs}
            onChange={(patch) => onChange({ ...action, ...patch })}
          />
        </FormGrid>
      );
    case "create-card":
      return (
        <FormGrid>
          <FormField label="Board" htmlFor={`${prefix}-board`}>
            <NativeSelect
              id={`${prefix}-board`}
              className="w-full"
              value={action.boardId}
              onChange={(event) =>
                onChange({
                  ...action,
                  boardId: event.target.value,
                  columnId: "",
                })
              }
            >
              <NativeSelectOption value="">—</NativeSelectOption>
              {boards.map((board) => (
                <NativeSelectOption key={board._id} value={board._id}>
                  {board.title}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </FormField>
          <FormField label="Column" htmlFor={`${prefix}-column`}>
            <NativeSelect
              id={`${prefix}-column`}
              className="w-full"
              value={action.columnId}
              onChange={(event) =>
                onChange({ ...action, columnId: event.target.value })
              }
            >
              <NativeSelectOption value="">—</NativeSelectOption>
              {columns.map((column) => (
                <NativeSelectOption key={column._id} value={column._id}>
                  {column.title}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </FormField>
          <FormField label="Title" htmlFor={`${prefix}-title`}>
            <Input
              id={`${prefix}-title`}
              value={action.title}
              onChange={(event) =>
                onChange({ ...action, title: event.target.value })
              }
            />
          </FormField>
          <FormField label="Due" htmlFor={`${prefix}-due`}>
            <Input
              id={`${prefix}-due`}
              value={action.dueDate ?? ""}
              placeholder="{{date}}"
              onChange={(event) => {
                const { dueDate: _due, ...rest } = action;
                onChange(
                  event.target.value
                    ? { ...rest, dueDate: event.target.value }
                    : rest,
                );
              }}
            />
          </FormField>
        </FormGrid>
      );
    case "create-event":
      return (
        <FormGrid>
          <FormField label="Title" htmlFor={`${prefix}-title`}>
            <Input
              id={`${prefix}-title`}
              value={action.title}
              onChange={(event) =>
                onChange({ ...action, title: event.target.value })
              }
            />
          </FormField>
          <FormField label="Date" htmlFor={`${prefix}-date`}>
            <Input
              id={`${prefix}-date`}
              value={action.date}
              onChange={(event) =>
                onChange({ ...action, date: event.target.value })
              }
            />
          </FormField>
          <FormField label="Time" htmlFor={`${prefix}-time`}>
            <Input
              id={`${prefix}-time`}
              type="time"
              value={action.time ?? ""}
              onChange={(event) => {
                const { time: _time, ...rest } = action;
                onChange(
                  event.target.value
                    ? { ...rest, time: event.target.value }
                    : rest,
                );
              }}
            />
          </FormField>
          <FormField label="Minutes" htmlFor={`${prefix}-minutes`}>
            <Input
              id={`${prefix}-minutes`}
              type="number"
              min={5}
              max={1440}
              value={action.durationMinutes}
              onChange={(event) =>
                onChange({
                  ...action,
                  durationMinutes: Math.min(
                    1440,
                    Math.max(5, Number(event.target.value) || 60),
                  ),
                })
              }
            />
          </FormField>
        </FormGrid>
      );
    case "set-todo": {
      const todos = todosOf(todoBlocks ?? []);
      return (
        <FormGrid>
          <FormField label="Page" htmlFor={`${prefix}-page`}>
            <PageSelect
              id={`${prefix}-page`}
              value={action.pageId}
              allowThisPage={allowThisPage}
              onChange={(pageId) =>
                onChange({
                  ...action,
                  pageId: pageId ?? THIS_PAGE,
                  blockId: "",
                })
              }
            />
          </FormField>
          <FormField label="To-do" htmlFor={`${prefix}-todo`}>
            <NativeSelect
              id={`${prefix}-todo`}
              className="w-full"
              value={action.blockId}
              onChange={(event) =>
                onChange({ ...action, blockId: event.target.value })
              }
            >
              <NativeSelectOption value="">—</NativeSelectOption>
              {todos.map((todo) => (
                <NativeSelectOption key={todo.id} value={todo.id}>
                  {plainText(todo.text) || "Untitled"}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </FormField>
          <FormField label="Checked" htmlFor={`${prefix}-checked`}>
            <Switch
              id={`${prefix}-checked`}
              checked={action.checked}
              onCheckedChange={(checked) => onChange({ ...action, checked })}
            />
          </FormField>
        </FormGrid>
      );
    }
    case "open":
      return (
        <FormGrid>
          <FormField label="URL" htmlFor={`${prefix}-url`}>
            <Input
              id={`${prefix}-url`}
              value={action.url}
              placeholder="/dashboard"
              onChange={(event) =>
                onChange({ ...action, url: event.target.value })
              }
            />
          </FormField>
        </FormGrid>
      );
  }
}

/**
 * An ordered list of actions. `hostPageId` is the page a button sits on;
 * null for a trigger, which has no "this page" and cannot open anything.
 */
export function ActionListEditor({
  actions,
  onChange,
  hostPageId,
}: {
  actions: WorkflowAction[];
  onChange: (actions: WorkflowAction[]) => void;
  hostPageId: string | null;
}) {
  const [adding, setAdding] = useState<WorkflowActionKind | "">("");
  const kinds = WORKFLOW_ACTION_KINDS.filter(
    (kind) =>
      hostPageId !== null || (kind !== "insert-template" && kind !== "open"),
  );
  const replace = (index: number, next: WorkflowAction) =>
    onChange(actions.map((action, i) => (i === index ? next : action)));
  const move = (index: number, by: number) => {
    const next = actions.slice();
    const [item] = next.splice(index, 1);
    if (!item) return;
    next.splice(index + by, 0, item);
    onChange(next);
  };

  return (
    <div className="flex flex-col gap-5">
      {actions.map((action, index) => (
        <div key={index} className="flex flex-col gap-3 border-l pl-4">
          <div className="flex items-center gap-2">
            <span className="text-[11px] tabular-nums text-muted-foreground">
              {index + 1}
            </span>
            <span className="flex-1 text-sm text-accent-strong">
              {ACTION_LABELS[action.kind]}
            </span>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label="Move up"
              disabled={index === 0}
              onClick={() => move(index, -1)}
            >
              <ArrowUp />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label="Move down"
              disabled={index === actions.length - 1}
              onClick={() => move(index, 1)}
            >
              <ArrowDown />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label="Remove"
              onClick={() => onChange(actions.filter((_, i) => i !== index))}
            >
              <X />
            </Button>
          </div>
          <ActionFields
            prefix={`action-${index}`}
            action={action}
            hostPageId={hostPageId}
            onChange={(next) => replace(index, next)}
          />
        </div>
      ))}
      {actions.length < WORKFLOW_ACTIONS_MAX ? (
        <div className="flex items-center gap-2">
          <NativeSelect
            aria-label="Action"
            size="sm"
            value={adding}
            onChange={(event) => {
              const kind = WORKFLOW_ACTION_KINDS.find(
                (k) => k === event.target.value,
              );
              setAdding(kind ?? "");
            }}
          >
            <NativeSelectOption value="">Action…</NativeSelectOption>
            {kinds.map((kind) => (
              <NativeSelectOption key={kind} value={kind}>
                {ACTION_LABELS[kind]}
              </NativeSelectOption>
            ))}
          </NativeSelect>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={!adding}
            onClick={() => {
              if (!adding) return;
              onChange([...actions, newAction(adding)]);
              setAdding("");
            }}
          >
            <Plus />
            Add
          </Button>
        </div>
      ) : null}
    </div>
  );
}
