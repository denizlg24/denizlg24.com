"use client";

import type { IShapeData, ITextData, IWhiteboardElement } from "@repo/schemas";
import { whiteboardElementKind } from "@repo/schemas";
import { Button } from "@repo/ui/button";
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
    const t = (el.data as unknown as ITextData).text.trim();
    return { icon: Type, label: t ? t.slice(0, 48) : "Text" };
  }
  if (kind === "pen") return { icon: PenLine, label: "Drawing" };
  if (kind === "image") return { icon: ImageIcon, label: "Image" };
  if (kind === "shape") {
    const s = (el.data as unknown as IShapeData).shapeType;
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
    <div className="absolute z-40 right-2 top-14 bottom-16 w-72 flex flex-col overflow-hidden rounded-lg border bg-surface shadow-xs">
      <div className="flex items-center justify-between px-3 h-9 border-b shrink-0">
        <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          <Layers className="size-3.5" />
          Elements
          <span className="tabular-nums">{elements.length}</span>
        </span>
        <Button size="icon-xs" variant="ghost" onClick={onClose}>
          <X />
        </Button>
      </div>
      <ScrollArea className="flex-1 min-h-0">
        <div className="flex flex-col p-1">
          {ordered.length === 0 && (
            <span className="px-2 py-3 text-xs text-muted-foreground/60 text-center">
              —
            </span>
          )}
          {ordered.map((el) => {
            const { icon: Icon, label } = describe(el);
            const isSelected = selectedIds.has(el.id);
            return (
              <div
                key={el.id}
                className={cn(
                  "group flex items-center gap-1.5 rounded px-1.5 py-1 text-xs cursor-default",
                  isSelected ? "bg-accent/60" : "hover:bg-muted/60",
                )}
              >
                <button
                  type="button"
                  onClick={(e) => onSelect(el.id, e.shiftKey || e.metaKey)}
                  className="flex items-center gap-1.5 flex-1 min-w-0 text-left"
                >
                  <Icon className="size-3.5 shrink-0 text-muted-foreground" />
                  <span className="truncate">{label}</span>
                </button>
                <div className="flex items-center opacity-0 group-hover:opacity-100 transition-opacity">
                  <Button
                    size="icon-xs"
                    variant="ghost"
                    className="size-5"
                    title="Bring forward"
                    onClick={() => onMoveZ(el.id, "up")}
                  >
                    <ChevronUp />
                  </Button>
                  <Button
                    size="icon-xs"
                    variant="ghost"
                    className="size-5"
                    title="Send backward"
                    onClick={() => onMoveZ(el.id, "down")}
                  >
                    <ChevronDown />
                  </Button>
                  <Button
                    size="icon-xs"
                    variant="ghost"
                    className="size-5 text-destructive"
                    title="Delete"
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
