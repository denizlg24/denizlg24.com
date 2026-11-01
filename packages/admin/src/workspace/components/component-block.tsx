"use client";

import type { BlockOf, ComponentProp, WorkspaceComponent } from "@repo/schemas";
import { Button } from "@repo/ui/button";
import { Input } from "@repo/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@repo/ui/popover";
import { Skeleton } from "@repo/ui/skeleton";
import { Switch } from "@repo/ui/switch";
import { cn } from "@repo/ui/utils";
import { Blocks, Pencil, Plus, SlidersHorizontal } from "lucide-react";
import { useState } from "react";
import { AppIcon } from "../page-icon";
import { ComponentEditor } from "./component-editor";
import { ComponentView } from "./component-view";
import { useComponent, useComponentList } from "./library";

type ComponentBlockProps = {
  block: BlockOf<"component">;
  editable: boolean;
  selected: boolean;
  onChange: (block: BlockOf<"component">) => void;
};

function ComponentPicker({
  onPick,
  onCreate,
}: {
  onPick: (id: string) => void;
  onCreate: () => void;
}) {
  const list = useComponentList();
  const [query, setQuery] = useState("");
  const matches = (list ?? []).filter((c) =>
    c.name.toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <div className="flex flex-col gap-1 rounded-sm bg-surface/50 p-2">
      <div className="flex items-center gap-2">
        <Blocks className="size-4 shrink-0 text-muted-foreground" />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Component"
          className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground/60"
        />
        <Button variant="ghost" size="xs" onClick={onCreate}>
          <Plus /> New
        </Button>
      </div>
      {list === null ? (
        <Skeleton className="h-6 w-full" />
      ) : (
        <div className="flex max-h-56 flex-col overflow-y-auto">
          {matches.map((component) => (
            <button
              key={component.id}
              type="button"
              onClick={() => onPick(component.id)}
              className="flex items-center gap-2 rounded-sm px-1.5 py-1 text-left text-sm hover:bg-surface"
            >
              <AppIcon
                value={component.icon}
                fallback={Blocks}
                className="text-muted-foreground"
              />
              <span className="truncate">{component.name}</span>
              <span className="ml-auto text-[11px] text-muted-foreground">
                {component.kind}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function PropsPopover({
  defs,
  block,
  onChange,
}: {
  defs: ComponentProp[];
  block: BlockOf<"component">;
  onChange: (block: BlockOf<"component">) => void;
}) {
  const set = (name: string, value: string | number | boolean) =>
    onChange({ ...block, props: { ...block.props, [name]: value } });
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="xs">
          <SlidersHorizontal /> Props
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="flex w-72 flex-col gap-2 p-3">
        {defs.map((def) => {
          const value = block.props[def.name] ?? def.default;
          const label = def.label || def.name;
          if (def.type === "boolean") {
            return (
              <div
                key={def.name}
                className="flex items-center justify-between text-sm"
              >
                {label}
                <Switch
                  aria-label={label}
                  checked={value === true}
                  onCheckedChange={(v) => set(def.name, v)}
                />
              </div>
            );
          }
          return (
            <div
              key={def.name}
              className="flex flex-col gap-1 text-xs text-muted-foreground"
            >
              {label}
              <Input
                aria-label={label}
                type={
                  def.type === "number"
                    ? "number"
                    : def.type === "date"
                      ? "date"
                      : def.type === "color"
                        ? "color"
                        : "text"
                }
                value={value === undefined ? "" : String(value)}
                onChange={(event) =>
                  set(
                    def.name,
                    def.type === "number"
                      ? Number(event.target.value)
                      : event.target.value,
                  )
                }
                className="h-8 text-sm"
              />
            </div>
          );
        })}
      </PopoverContent>
    </Popover>
  );
}

/** Places a library component on the page, with this block's prop values. */
export function ComponentBlock({
  block,
  editable,
  selected,
  onChange,
}: ComponentBlockProps) {
  const loaded = useComponent(block.componentId);
  const [editorOpen, setEditorOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const component: WorkspaceComponent | null =
    loaded && loaded !== "missing" ? loaded : null;

  const editor = (
    <ComponentEditor
      open={editorOpen}
      onOpenChange={setEditorOpen}
      component={creating ? null : component}
      onSaved={(saved) => {
        if (creating) onChange({ ...block, componentId: saved.id });
        setCreating(false);
      }}
    />
  );

  if (!block.componentId) {
    if (!editable) return null;
    return (
      <>
        <ComponentPicker
          onPick={(componentId) => onChange({ ...block, componentId })}
          onCreate={() => {
            setCreating(true);
            setEditorOpen(true);
          }}
        />
        {editor}
      </>
    );
  }

  if (loaded === null) return <Skeleton className="h-24 w-full" />;
  if (loaded === "missing") {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Blocks className="size-4" /> —
        {editable ? (
          <Button
            variant="ghost"
            size="xs"
            onClick={() => onChange({ ...block, componentId: "" })}
          >
            Pick another
          </Button>
        ) : null}
      </div>
    );
  }

  return (
    <div className="group/component relative flex flex-col gap-1">
      {component ? (
        <ComponentView
          component={component}
          props={block.props}
          height={block.height}
        />
      ) : null}
      {editable && component ? (
        <div
          className={cn(
            "absolute -top-3 right-0 flex items-center gap-0.5 rounded-md bg-background/90 px-1 shadow-sm transition-opacity",
            selected
              ? "opacity-100"
              : "opacity-0 group-hover/component:opacity-100",
          )}
        >
          <span className="px-1 text-[11px] text-muted-foreground">
            {component.name}
          </span>
          {component.props.length ? (
            <PropsPopover
              defs={component.props}
              block={block}
              onChange={onChange}
            />
          ) : null}
          <Button variant="ghost" size="xs" onClick={() => setEditorOpen(true)}>
            <Pencil /> Edit
          </Button>
          <Button
            variant="ghost"
            size="xs"
            onClick={() => onChange({ ...block, componentId: "", props: {} })}
          >
            Swap
          </Button>
        </div>
      ) : null}
      {editor}
    </div>
  );
}
