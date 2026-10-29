"use client";

import type { IWhiteboardElement } from "@repo/schemas";
import { whiteboardElementKind } from "@repo/schemas";
import { Button } from "@repo/ui/button";
import { EmptyState } from "@repo/ui/empty-state";
import { ScrollArea } from "@repo/ui/scroll-area";
import type { LucideIcon } from "lucide-react";
import {
  ArrowUpRight,
  ChevronDown,
  ChevronUp,
  Circle,
  Component,
  Image as ImageIcon,
  Layers,
  Minus,
  PenLine,
  Square,
  Trash2,
  Type,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { templateRegistry } from "./templates";

interface LayersPanelProps {
  elements: IWhiteboardElement[];
  selectedIds: Set<string>;
  onSelect: (id: string, additive: boolean) => void;
  onMoveZ: (id: string, dir: "up" | "down") => void;
  onDelete: (id: string) => void;
  onClose: () => void;
}

function describe(el: IWhiteboardElement): { icon: LucideIcon; label: string } {
  const kind = whiteboardElementKind(el);
  if (kind === "text") {
    const text = typeof el.data.text === "string" ? el.data.text.trim() : "";
    return { icon: Type, label: text ? text.slice(0, 48) : "Text" };
  }
  if (kind === "pen") return { icon: PenLine, label: "Drawing" };
  if (kind === "image") return { icon: ImageIcon, label: "Image" };
  if (kind === "shape") {
    const s =
      typeof el.data.shapeType === "string" ? el.data.shapeType : "shape";
    const icon =
      s === "circle"
        ? Circle
        : s === "arrow" || s === "line"
          ? ArrowUpRight
          : Square;
    return { icon, label: s };
  }
  if (el.type === "component") {
    const def = el.componentType
      ? templateRegistry[el.componentType]
      : undefined;
    return {
      icon: Component,
      label: def?.name ?? el.componentType ?? "Component",
    };
  }
  return { icon: Minus, label: "Element" };
}

export function WhiteboardLayersPanel({
  elements,
  selectedIds,
  onSelect,
  onMoveZ,
  onDelete,
  onClose,
}: LayersPanelProps) {
  const ordered = [...elements].sort((a, b) => b.zIndex - a.zIndex);

  return (
    <div className="absolute top-3 right-3 bottom-16 z-40 flex w-72 flex-col overflow-hidden rounded-lg border bg-background/95 shadow-sm backdrop-blur">
      <div className="flex h-9 shrink-0 items-center gap-1.5 border-b pr-1 pl-3">
        <Layers className="size-3.5 text-muted-foreground" />
        <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
          Elements
        </span>
        <span className="text-[11px] tabular-nums text-muted-foreground/70">
          {elements.length}
        </span>
        <Button
          size="icon-xs"
          variant="ghost"
          className="ml-auto"
          aria-label="Close"
          onClick={onClose}
        >
          <X />
        </Button>
      </div>
      <ScrollArea className="flex-1 min-h-0">
        <div className="flex flex-col p-1">
          {ordered.length === 0 && <EmptyState compact label="No elements" />}
          {ordered.map((el) => {
            const { icon: Icon, label } = describe(el);
            const isSelected = selectedIds.has(el.id);
            return (
              <div
                key={el.id}
                className={cn(
                  "group flex cursor-default items-center gap-1.5 rounded-md px-1.5 py-1 text-xs",
                  isSelected
                    ? "bg-surface text-accent-strong"
                    : "hover:bg-surface/70",
                )}
              >
                <button
                  type="button"
                  onClick={(e) => onSelect(el.id, e.shiftKey || e.metaKey)}
                  className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
                >
                  <Icon className="size-3.5 shrink-0 text-muted-foreground" />
                  <span className="truncate">{label}</span>
                </button>
                <div className="flex items-center opacity-0 group-hover:opacity-100 transition-opacity">
                  <Button
                    size="icon-xs"
                    variant="ghost"
                    className="size-5"
                    aria-label="Bring forward"
                    onClick={() => onMoveZ(el.id, "up")}
                  >
                    <ChevronUp />
                  </Button>
                  <Button
                    size="icon-xs"
                    variant="ghost"
                    className="size-5"
                    aria-label="Send backward"
                    onClick={() => onMoveZ(el.id, "down")}
                  >
                    <ChevronDown />
                  </Button>
                  <Button
                    size="icon-xs"
                    variant="ghost"
                    className="size-5 text-muted-foreground hover:text-destructive"
                    aria-label="Delete"
                    onClick={() => onDelete(el.id)}
                  >
                    <Trash2 />
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      </ScrollArea>
    </div>
  );
}
