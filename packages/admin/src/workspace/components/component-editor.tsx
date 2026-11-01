"use client";

import {
  type ComponentBinding,
  type ComponentInput,
  type ComponentProp,
  componentBindingSchema,
  componentInputSchema,
  componentPropSchema,
  UI_NODE_TYPES,
  UI_TONES,
  type UiNode,
  type UiNodeType,
  type WorkflowAction,
  type WorkspaceComponent,
  workflowActionsSchema,
} from "@repo/schemas";
import { Button } from "@repo/ui/button";
import { ConfirmButton } from "@repo/ui/confirm-button";
import { Dialog, DialogContent, DialogTitle } from "@repo/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@repo/ui/dropdown-menu";
import { Input } from "@repo/ui/input";
import { JsonEditor, useJsonDraft } from "@repo/ui/json-editor";
import { SegmentedControl } from "@repo/ui/segmented-control";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@repo/ui/select";
import { Textarea } from "@repo/ui/textarea";
import { cn } from "@repo/ui/utils";
import { ArrowDown, ArrowUp, Copy, Plus, Trash2 } from "lucide-react";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { z } from "zod";
import { useAdmin } from "../../provider";
import { AppIcon, IconPicker } from "../page-icon";
import { ComponentView } from "./component-view";
import { useComponentLibrary } from "./library";
import {
  appendChild,
  cloneNode,
  createNode,
  findNode,
  insertAfter,
  isContainerNode,
  moveNode,
  parentOf,
  removeNode,
  replaceNode,
} from "./spec-tree";
import { COMPONENT_STARTERS } from "./starters";

type Draft = z.output<typeof componentInputSchema>;
type Tab = "visual" | "json" | "code" | "data" | "props";

const bindingsSchema = z.array(componentBindingSchema).max(8);
const propsSchema = z.array(componentPropSchema).max(20);

function toDraft(source: WorkspaceComponent | ComponentInput): Draft {
  return componentInputSchema.parse(source);
}

const LABEL =
  "text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground";

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span className={LABEL}>{label}</span>
      {children}
    </div>
  );
}

function TextField({
  label,
  value,
  onChange,
  placeholder,
  multiline,
}: {
  label: string;
  value: string | undefined;
  onChange: (value: string | undefined) => void;
  placeholder?: string;
  multiline?: boolean;
}) {
  const props = {
    value: value ?? "",
    placeholder,
    onChange: (event: { target: { value: string } }) =>
      onChange(event.target.value === "" ? undefined : event.target.value),
    className: "font-mono text-xs",
  };
  return (
    <Field label={label}>
      {multiline ? <Textarea rows={3} {...props} /> : <Input {...props} />}
    </Field>
  );
}

function ChoiceField<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T | undefined;
  options: readonly T[];
  onChange: (value: T | undefined) => void;
}) {
  return (
    <Field label={label}>
      <Select
        value={value ?? "__unset"}
        onValueChange={(next) =>
          onChange(next === "__unset" ? undefined : (next as T))
        }
      >
        <SelectTrigger className="h-8 text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="__unset">—</SelectItem>
          {options.map((option) => (
            <SelectItem key={option} value={option}>
              {option}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Field>
  );
}

function NumberField({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  value: number | undefined;
  min: number;
  max: number;
  onChange: (value: number | undefined) => void;
}) {
  return (
    <Field label={label}>
      <Input
        type="number"
        min={min}
        max={max}
        value={value ?? ""}
        onChange={(event) => {
          const n = Number(event.target.value);
          onChange(
            event.target.value === "" || !Number.isFinite(n)
              ? undefined
              : Math.max(min, Math.min(max, Math.round(n))),
          );
        }}
        className="h-8 text-xs"
      />
    </Field>
  );
}

/** Fields that mean something for each node type. */
const FIELDS: Record<UiNodeType, readonly string[]> = {
  stack: ["gap", "align", "surface", "repeat", "when"],
  row: ["gap", "align", "surface", "repeat", "when"],
  grid: ["columns", "gap", "surface", "repeat", "when"],
  card: ["gap", "align", "surface", "repeat", "when"],
  list: ["repeat", "surface", "when"],
  text: ["text", "size", "tone", "when"],
  heading: ["text", "caption", "level", "icon", "tone", "when"],
  stat: ["text", "value", "caption", "icon", "size", "tone", "when"],
  badge: ["text", "icon", "tone", "when"],
  icon: ["icon", "size", "tone", "when"],
  image: ["href", "text", "when"],
  progress: ["text", "value", "max", "caption", "tone", "when"],
  divider: ["when"],
  spacer: ["gap", "when"],
  link: ["text", "href", "size", "tone", "when"],
  button: ["text", "href", "icon", "tone", "when"],
  chart: ["value", "chart", "size", "when"],
  countdown: ["value", "text", "size", "tone", "when"],
  clock: ["text", "size", "tone", "when"],
  markdown: ["text", "when"],
};

function Inspector({
  node,
  onChange,
}: {
  node: UiNode;
  onChange: (node: UiNode) => void;
}) {
  const fields = FIELDS[node.type];
  const set = <K extends keyof UiNode>(
    key: K,
    value: UiNode[K] | undefined,
  ) => {
    const next = { ...node };
    if (value === undefined) delete next[key];
    else next[key] = value;
    onChange(next);
  };
  const has = (field: string) => fields.includes(field);
  return (
    <div className="grid grid-cols-2 gap-3">
      <ChoiceField
        label="Type"
        value={node.type}
        options={UI_NODE_TYPES}
        onChange={(type) => {
          if (!type) return;
          const fresh = createNode(type);
          onChange({
            ...fresh,
            id: node.id,
            ...(isContainerNode(fresh)
              ? { children: node.children ?? [] }
              : {}),
          });
        }}
      />
      {has("text") ? (
        <div className="col-span-2">
          <TextField
            label={
              node.type === "clock"
                ? "Format"
                : node.type === "image"
                  ? "Alt"
                  : "Text"
            }
            value={node.text}
            onChange={(v) => set("text", v)}
            multiline={node.type === "markdown" || node.type === "text"}
          />
        </div>
      ) : null}
      {has("value") ? (
        <TextField
          label={
            node.type === "countdown"
              ? "Date"
              : node.type === "chart"
                ? "Data"
                : "Value"
          }
          value={node.value}
          onChange={(v) => set("value", v)}
          placeholder="{{path}}"
        />
      ) : null}
      {has("max") ? (
        <TextField
          label="Max"
          value={node.max}
          onChange={(v) => set("max", v)}
        />
      ) : null}
      {has("caption") ? (
        <TextField
          label="Caption"
          value={node.caption}
          onChange={(v) => set("caption", v)}
        />
      ) : null}
      {has("href") ? (
        <div className="col-span-2">
          <TextField
            label={node.type === "image" ? "Image URL" : "Link"}
            value={node.href}
            onChange={(v) => set("href", v)}
            placeholder="https://"
          />
        </div>
      ) : null}
      {has("icon") ? (
        <Field label="Icon">
          <IconPicker
            value={node.icon ?? null}
            onChange={(v) => set("icon", v ?? undefined)}
          >
            <Button variant="outline" size="sm" className="h-8 w-fit">
              <AppIcon value={node.icon} />
              {node.icon ? null : "None"}
            </Button>
          </IconPicker>
        </Field>
      ) : null}
      {has("tone") ? (
        <ChoiceField
          label="Tone"
          value={node.tone}
          options={UI_TONES}
          onChange={(v) => set("tone", v)}
        />
      ) : null}
      {has("size") ? (
        <ChoiceField
          label="Size"
          value={node.size}
          options={["xs", "sm", "md", "lg", "xl"] as const}
          onChange={(v) => set("size", v)}
        />
      ) : null}
      {has("align") ? (
        <ChoiceField
          label="Align"
          value={node.align}
          options={["start", "center", "end", "between"] as const}
          onChange={(v) => set("align", v)}
        />
      ) : null}
      {has("surface") ? (
        <ChoiceField
          label="Surface"
          value={node.surface}
          options={["none", "surface", "muted", "accent", "outline"] as const}
          onChange={(v) => set("surface", v)}
        />
      ) : null}
      {has("gap") ? (
        <NumberField
          label="Gap"
          value={node.gap}
          min={0}
          max={16}
          onChange={(v) => set("gap", v)}
        />
      ) : null}
      {has("columns") ? (
        <NumberField
          label="Columns"
          value={node.columns}
          min={1}
          max={12}
          onChange={(v) => set("columns", v)}
        />
      ) : null}
      {has("level") ? (
        <ChoiceField
          label="Level"
          value={
            node.level ? (String(node.level) as "1" | "2" | "3") : undefined
          }
          options={["1", "2", "3"] as const}
          onChange={(v) =>
            set("level", v ? (Number(v) as 1 | 2 | 3) : undefined)
          }
        />
      ) : null}
      {has("chart") ? (
        <>
          <ChoiceField
            label="Chart"
            value={node.chart?.kind}
            options={["bar", "line", "area", "pie"] as const}
            onChange={(kind) =>
              set(
                "chart",
                kind
                  ? { x: "label", y: ["value"], ...node.chart, kind }
                  : undefined,
              )
            }
          />
          <TextField
            label="X field"
            value={node.chart?.x}
            onChange={(x) =>
              node.chart && set("chart", { ...node.chart, x: x ?? "" })
            }
          />
          <div className="col-span-2">
            <TextField
              label="Y fields (comma separated)"
              value={node.chart?.y.join(", ")}
              onChange={(y) =>
                node.chart &&
                set("chart", {
                  ...node.chart,
                  y: (y ?? "")
                    .split(",")
                    .map((s) => s.trim())
                    .filter(Boolean)
                    .slice(0, 6),
                })
              }
            />
          </div>
        </>
      ) : null}
      {has("repeat") ? (
        <TextField
          label="Repeat over"
          value={node.repeat}
          onChange={(v) => set("repeat", v)}
          placeholder="tasks.rows"
        />
      ) : null}
      {node.type === "button" ? (
        <div className="col-span-2 flex flex-col gap-3">
          <Field label="Actions">
            <JsonField
              id={`actions-${node.id}`}
              schema={workflowActionsSchema}
              value={node.actions ?? []}
              onChange={(actions) =>
                set("actions", actions.length ? actions : undefined)
              }
              rows={8}
              templates={ACTION_TEMPLATES}
            />
          </Field>
          <Field label="Action variables">
            <JsonField
              id={`vars-${node.id}`}
              schema={actionVarsSchema}
              value={node.actionVars ?? {}}
              onChange={(vars) =>
                set("actionVars", Object.keys(vars).length ? vars : undefined)
              }
              rows={3}
            />
          </Field>
        </div>
      ) : null}
      <TextField
        label="Show when"
        value={node.when}
        onChange={(v) => set("when", v)}
        placeholder="path or !path"
      />
    </div>
  );
}

function Outline({
  root,
  selectedId,
  onSelect,
  depth = 0,
}: {
  root: UiNode;
  selectedId: string;
  onSelect: (id: string) => void;
  depth?: number;
}) {
  const label = root.text?.slice(0, 28) || root.value?.slice(0, 28) || "";
  return (
    <>
      <button
        type="button"
        onClick={() => onSelect(root.id)}
        style={{ paddingLeft: `${depth * 12 + 6}px` }}
        className={cn(
          "flex w-full items-center gap-2 rounded-sm py-1 pr-1.5 text-left text-xs",
          selectedId === root.id
            ? "bg-surface text-accent-strong"
            : "text-muted-foreground hover:bg-surface/60",
        )}
      >
        <span className="font-mono text-[11px]">{root.type}</span>
        {root.repeat ? (
          <span className="text-[10px] text-accent">×{root.repeat}</span>
        ) : null}
        <span className="truncate">{label}</span>
      </button>
      {root.children?.map((child) => (
        <Outline
          key={child.id}
          root={child}
          selectedId={selectedId}
          onSelect={onSelect}
          depth={depth + 1}
        />
      ))}
    </>
  );
}

function VisualEditor({
  spec,
  onChange,
  selectedId,
  onSelect,
}: {
  spec: UiNode;
  onChange: (spec: UiNode) => void;
  selectedId: string;
  onSelect: (id: string) => void;
}) {
  const selected = findNode(spec, selectedId) ?? spec;
  const isRoot = selected.id === spec.id;
  const add = (type: UiNodeType) => {
    const node = createNode(type);
    onChange(
      isContainerNode(selected)
        ? appendChild(spec, selected.id, node)
        : insertAfter(spec, selected.id, node),
    );
    onSelect(node.id);
  };
  return (
    <div className="grid min-h-0 grid-cols-[minmax(0,13rem)_minmax(0,1fr)] gap-4">
      <div className="flex min-h-0 flex-col gap-2">
        <div className="flex items-center gap-1">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="h-7">
                <Plus /> Add
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="start"
              className="max-h-80 overflow-y-auto"
            >
              {UI_NODE_TYPES.map((type) => (
                <DropdownMenuItem key={type} onSelect={() => add(type)}>
                  {type}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Move up"
            disabled={isRoot}
            onClick={() => onChange(moveNode(spec, selected.id, -1))}
          >
            <ArrowUp />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Move down"
            disabled={isRoot}
            onClick={() => onChange(moveNode(spec, selected.id, 1))}
          >
            <ArrowDown />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Duplicate"
            disabled={isRoot}
            onClick={() => {
              const copy = cloneNode(selected);
              onChange(insertAfter(spec, selected.id, copy));
              onSelect(copy.id);
            }}
          >
            <Copy />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Delete"
            disabled={isRoot}
            onClick={() => {
              const parent = parentOf(spec, selected.id);
              onChange(removeNode(spec, selected.id));
              onSelect(parent?.id ?? spec.id);
            }}
          >
            <Trash2 />
          </Button>
        </div>
        <div className="flex max-h-[28rem] flex-col overflow-y-auto">
          <Outline root={spec} selectedId={selected.id} onSelect={onSelect} />
        </div>
      </div>
      <div className="min-w-0">
        <Inspector
          key={selected.id}
          node={selected}
          onChange={(node) => onChange(replaceNode(spec, selected.id, node))}
        />
      </div>
    </div>
  );
}

function CodeEditor({
  draft,
  onChange,
}: {
  draft: Draft;
  onChange: (patch: Partial<Draft>) => void;
}) {
  const mono = "font-mono text-xs leading-relaxed";
  return (
    <div className="flex flex-col gap-3">
      <Field label="HTML">
        <Textarea
          rows={8}
          spellCheck={false}
          value={draft.html}
          onChange={(e) => onChange({ html: e.target.value })}
          className={mono}
        />
      </Field>
      <Field label="CSS">
        <Textarea
          rows={6}
          spellCheck={false}
          value={draft.css}
          onChange={(e) => onChange({ css: e.target.value })}
          className={mono}
        />
      </Field>
      <Field label="JS">
        <Textarea
          rows={8}
          spellCheck={false}
          value={draft.js}
          onChange={(e) => onChange({ js: e.target.value })}
          className={mono}
        />
      </Field>
      <NumberField
        label="Height"
        value={draft.height}
        min={40}
        max={2000}
        onChange={(height) => onChange({ height: height ?? 240 })}
      />
    </div>
  );
}

/** Edits a JSON-shaped field through a draft, committing only when it validates. */
function JsonField<T>({
  id,
  schema,
  value,
  onChange,
  templates,
  rows,
}: {
  id: string;
  schema: z.ZodType<T>;
  value: T;
  onChange: (value: T) => void;
  templates?: { label: string; value: unknown }[];
  rows?: number;
}) {
  const draft = useJsonDraft(schema, value);
  const { result } = draft;
  useEffect(() => {
    if (result.ok) onChange(result.data);
  }, [result]);
  return (
    <JsonEditor id={id} draft={draft} rows={rows ?? 18} templates={templates} />
  );
}

const actionVarsSchema = z.record(z.string().max(40), z.string().max(4000));

const ACTION_TEMPLATES: { label: string; value: WorkflowAction[] }[] = [
  {
    label: "card",
    value: [
      {
        kind: "create-card",
        boardId: "000000000000000000000000",
        columnId: "000000000000000000000000",
        title: "{{event.title}}",
      },
    ],
  },
  {
    label: "todo",
    value: [
      {
        kind: "set-todo",
        pageId: "$this",
        blockId: "todo-block-id",
        checked: true,
      },
    ],
  },
  {
    label: "append",
    value: [
      {
        kind: "append-blocks",
        pageId: "$this",
        markdown: "- {{date}} {{event.note}}",
      },
    ],
  },
];

const BINDING_TEMPLATES: { label: string; value: ComponentBinding[] }[] = [
  {
    label: "view",
    value: [
      {
        name: "rows",
        kind: "view",
        view: {
          source: "kanban-cards",
          layout: "table",
          filters: [],
          sort: [],
          limit: 10,
        },
      },
    ],
  },
  {
    label: "collection",
    value: [
      {
        name: "rows",
        kind: "collection",
        query: {
          collection: "notes",
          filter: [],
          limit: 20,
          fields: ["title", "updatedAt"],
        },
      },
    ],
  },
  { label: "records", value: [{ name: "items", kind: "records", refs: [] }] },
  { label: "json", value: [{ name: "data", kind: "json", value: [] }] },
];

const PROP_TEMPLATES: { label: string; value: ComponentProp[] }[] = [
  {
    label: "text",
    value: [{ name: "title", label: "Title", type: "text", default: "" }],
  },
  {
    label: "date",
    value: [
      { name: "date", label: "Date", type: "date", default: "2026-12-25" },
    ],
  },
];

/**
 * Builds a custom UI element three ways: the visual tree (spec), the whole
 * component as JSON, or code (html). Data, props and the preview are shared.
 */
export function ComponentEditor({
  open,
  onOpenChange,
  component,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Null makes a new one, from a starter. */
  component: WorkspaceComponent | null;
  onSaved?: (component: WorkspaceComponent) => void;
}) {
  const { client } = useAdmin();
  const create = useComponentLibrary((s) => s.create);
  const update = useComponentLibrary((s) => s.update);
  const remove = useComponentLibrary((s) => s.remove);
  const [draft, setDraft] = useState<Draft>(() =>
    toDraft(component ?? COMPONENT_STARTERS[0].input),
  );
  const [tab, setTab] = useState<Tab>(
    draft.kind === "html" ? "code" : "visual",
  );
  const [selectedId, setSelectedId] = useState(draft.spec?.id ?? "root");
  const [jsonKey, setJsonKey] = useState(0);
  const [saving, setSaving] = useState(false);

  const latest = useRef(component);
  latest.current = component;
  const seedKey = open ? (component?.id ?? "new") : null;
  // Re-seed on open or a different component only: a focus refresh replaces
  // the stored object, which must not wipe an edit in progress.
  useEffect(() => {
    if (seedKey === null) return;
    const next = toDraft(latest.current ?? COMPONENT_STARTERS[0].input);
    setDraft(next);
    setTab(next.kind === "html" ? "code" : "visual");
    setSelectedId(next.spec?.id ?? "root");
    setJsonKey((k) => k + 1);
  }, [seedKey]);

  const patch = (next: Partial<Draft>) => setDraft((d) => ({ ...d, ...next }));
  const valid = useMemo(() => componentInputSchema.safeParse(draft), [draft]);

  const save = async () => {
    if (!valid.success) {
      toast.error(valid.error.issues[0]?.message ?? "Invalid component");
      return;
    }
    setSaving(true);
    try {
      const saved = component
        ? await update(client, component.id, valid.data)
        : await create(client, valid.data);
      onSaved?.(saved);
      onOpenChange(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const tabs: { value: Tab; label: string }[] = [
    ...(draft.kind === "spec"
      ? [{ value: "visual" as const, label: "Visual" }]
      : []),
    ...(draft.kind === "html"
      ? [{ value: "code" as const, label: "Code" }]
      : []),
    { value: "data", label: "Data" },
    { value: "props", label: "Props" },
    { value: "json", label: "JSON" },
  ];

  return (
    <Dialog open={open} onOpenChange={saving ? undefined : onOpenChange}>
      <DialogContent
        size="xl"
        className="flex flex-col gap-0 overflow-hidden p-0"
        aria-describedby={undefined}
      >
        <div className="flex items-center gap-3 border-b px-5 py-3">
          <IconPicker value={draft.icon} onChange={(icon) => patch({ icon })}>
            <button
              type="button"
              aria-label="Icon"
              className="rounded-md p-1 hover:bg-surface"
            >
              <AppIcon value={draft.icon} fallback={Plus} />
            </button>
          </IconPicker>
          <DialogTitle className="sr-only">Component</DialogTitle>
          <input
            value={draft.name}
            onChange={(event) => patch({ name: event.target.value })}
            className="theme-heading min-w-0 flex-1 bg-transparent text-base font-semibold text-accent-strong outline-none"
          />
          {component ? null : (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-muted-foreground"
                >
                  Start from…
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {COMPONENT_STARTERS.map((starter) => (
                  <DropdownMenuItem
                    key={starter.label}
                    onSelect={() => {
                      const next = toDraft(starter.input);
                      setDraft(next);
                      setTab(next.kind === "html" ? "code" : "visual");
                      setSelectedId(next.spec?.id ?? "root");
                      setJsonKey((k) => k + 1);
                    }}
                  >
                    {starter.label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          <SegmentedControl
            ariaLabel="Kind"
            value={draft.kind}
            className="w-44 [&_button]:min-h-7 [&_button]:text-xs"
            options={[
              { value: "spec", label: "Native" },
              { value: "html", label: "HTML" },
            ]}
            onValueChange={(kind) => {
              patch({
                kind,
                ...(kind === "spec" && !draft.spec
                  ? { spec: { id: "root", type: "stack", children: [] } }
                  : {}),
              });
              setTab(kind === "html" ? "code" : "visual");
            }}
          />
        </div>

        <div className="grid min-h-0 flex-1 grid-cols-1 overflow-hidden lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)]">
          <div className="flex min-h-0 flex-col gap-3 overflow-y-auto border-r px-5 py-4">
            <div className="flex items-center gap-1">
              {tabs.map((t) => (
                <button
                  key={t.value}
                  type="button"
                  onClick={() => {
                    setTab(t.value);
                    if (t.value === "json") setJsonKey((k) => k + 1);
                  }}
                  className={cn(
                    "rounded px-2 py-1 text-xs font-medium",
                    tab === t.value
                      ? "bg-surface text-accent-strong"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {t.label}
                </button>
              ))}
            </div>
            <Input
              value={draft.description}
              onChange={(event) => patch({ description: event.target.value })}
              placeholder="Description"
              className="h-8 text-xs"
            />
            {tab === "visual" && draft.spec ? (
              <VisualEditor
                spec={draft.spec}
                onChange={(spec) => patch({ spec })}
                selectedId={selectedId}
                onSelect={setSelectedId}
              />
            ) : null}
            {tab === "code" ? (
              <CodeEditor draft={draft} onChange={patch} />
            ) : null}
            {tab === "data" ? (
              <JsonField
                key={`bindings:${jsonKey}`}
                id="component-bindings"
                schema={bindingsSchema}
                value={draft.bindings}
                onChange={(bindings) => patch({ bindings })}
                templates={BINDING_TEMPLATES}
              />
            ) : null}
            {tab === "props" ? (
              <JsonField
                key={`props:${jsonKey}`}
                id="component-props"
                schema={propsSchema}
                value={draft.props}
                onChange={(props) => patch({ props })}
                templates={PROP_TEMPLATES}
              />
            ) : null}
            {tab === "json" ? (
              <JsonField
                key={`all:${jsonKey}`}
                id="component-json"
                schema={componentInputSchema}
                value={draft}
                onChange={(next) => setDraft(next)}
                rows={26}
              />
            ) : null}
          </div>
          <div className="flex min-h-0 flex-col gap-2 overflow-y-auto bg-background px-5 py-4">
            <span className={LABEL}>Preview</span>
            {valid.success ? (
              <ComponentView
                component={valid.data}
                selectedId={tab === "visual" ? selectedId : null}
                onSelect={tab === "visual" ? setSelectedId : undefined}
              />
            ) : (
              <span className="text-xs text-destructive">
                {valid.error.issues[0]?.path.join(".")}:{" "}
                {valid.error.issues[0]?.message}
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 border-t px-5 py-3">
          {component ? (
            <ConfirmButton
              title={`Delete ${component.name}?`}
              actionLabel="Delete"
              destructive
              trigger={
                <Button variant="ghost" size="sm" className="text-destructive">
                  <Trash2 /> Delete
                </Button>
              }
              onConfirm={async () => {
                await remove(client, component.id);
                onOpenChange(false);
              }}
            />
          ) : null}
          <span className="flex-1" />
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={saving}
          >
            Cancel
          </Button>
          <Button
            onClick={() => void save()}
            disabled={saving || !valid.success}
          >
            Save
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
