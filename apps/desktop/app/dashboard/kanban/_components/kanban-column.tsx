"use client";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@repo/ui/alert-dialog";
import { Button } from "@repo/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@repo/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@repo/ui/dropdown-menu";
import { Input } from "@repo/ui/input";
import { Label } from "@repo/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@repo/ui/select";
import { Switch } from "@repo/ui/switch";
import { Textarea } from "@repo/ui/textarea";
import {
  ChevronsRight,
  MoreHorizontal,
  Palette,
  PanelLeftClose,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import { useMemo, useState } from "react";
import type { IKanbanCard, IKanbanColumn } from "@/lib/data-types";
import {
  COLUMN_COLORS,
  ColumnColorPicker,
  ColumnIconPicker,
} from "./column-customization";
import { KanbanCardItem } from "./kanban-card-item";

export type ColumnWithCards = IKanbanColumn & { cards: IKanbanCard[] };
export type DraggingState =
  | { kind: "card"; cardId: string; fromColumnId: string }
  | { kind: "column"; columnId: string };

type ColumnUpdates = {
  title?: string;
  description?: string;
  color?: string;
  icon?: string;
  wipLimit?: number | null;
  isDoneColumn?: boolean;
  isCollapsed?: boolean;
  sortRule?: "manual" | "priority" | "dueDate";
};

interface Props {
  column: ColumnWithCards;
  dragging: DraggingState | null;
  onCardDragStart: (cardId: string, fromColumnId: string) => void;
  onColumnDragStart: (columnId: string) => void;
  onCardDragOver: (columnId: string, beforeCardId: string | null) => void;
  onDrop: (columnId: string) => void;
  onCardClick: (card: IKanbanCard) => void;
  onAddCard: (columnId: string, title: string) => void;
  onUpdateColumn: (columnId: string, updates: ColumnUpdates) => void;
  onDeleteColumn: (columnId: string) => void;
  onClearColumn: (columnId: string) => void;
}

const PRIORITY_RANK = { urgent: 0, high: 1, medium: 2, low: 3, none: 4 };

export function KanbanColumn({
  column,
  dragging,
  onCardDragStart,
  onColumnDragStart,
  onCardDragOver,
  onDrop,
  onCardClick,
  onAddCard,
  onUpdateColumn,
  onDeleteColumn,
  onClearColumn,
}: Props) {
  const [editingTitle, setEditingTitle] = useState(false);
  const [title, setTitle] = useState(column.title);
  const [addingCard, setAddingCard] = useState(false);
  const [newCardTitle, setNewCardTitle] = useState("");
  const [customizeOpen, setCustomizeOpen] = useState(false);
  const [clearOpen, setClearOpen] = useState(false);
  const [editDescription, setEditDescription] = useState(
    column.description ?? "",
  );
  const [editColor, setEditColor] = useState(column.color ?? COLUMN_COLORS[0]);
  const [editIcon, setEditIcon] = useState(column.icon ?? "circle");
  const [editWip, setEditWip] = useState(column.wipLimit?.toString() ?? "");
  const [editDone, setEditDone] = useState(column.isDoneColumn ?? false);
  const [editSort, setEditSort] = useState(column.sortRule ?? "manual");

  const sortRule = column.sortRule ?? "manual";
  const cards = useMemo(() => {
    if (sortRule === "manual") return column.cards;
    return [...column.cards].sort((a, b) => {
      if (sortRule === "priority")
        return PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
      if (!a.dueDate) return 1;
      if (!b.dueDate) return -1;
      return new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime();
    });
  }, [column.cards, sortRule]);

  const addCard = () => {
    if (!newCardTitle.trim()) return;
    onAddCard(column._id, newCardTitle.trim());
    setNewCardTitle("");
    setAddingCard(false);
  };
  const openCustomize = () => {
    setEditDescription(column.description ?? "");
    setEditColor(column.color ?? COLUMN_COLORS[0]);
    setEditIcon(column.icon ?? "circle");
    setEditWip(column.wipLimit?.toString() ?? "");
    setEditDone(column.isDoneColumn ?? false);
    setEditSort(column.sortRule ?? "manual");
    setCustomizeOpen(true);
  };
  const saveCustomize = () => {
    const parsedWip = Number.parseInt(editWip, 10);
    onUpdateColumn(column._id, {
      description: editDescription.trim(),
      color: editColor,
      icon: editIcon,
      wipLimit: parsedWip > 0 ? parsedWip : null,
      isDoneColumn: editDone,
      sortRule: editSort,
    });
    setCustomizeOpen(false);
  };

  if (column.isCollapsed) {
    return (
      <button
        type="button"
        className="flex h-full w-11 shrink-0 flex-col items-center gap-3 border-r border-border/70 py-3 text-muted-foreground transition-colors hover:bg-accent/40 hover:text-foreground"
        onClick={() => onUpdateColumn(column._id, { isCollapsed: false })}
        onMouseUp={() => dragging?.kind === "card" && onDrop(column._id)}
        title={`Expand ${column.title}`}
      >
        <ChevronsRight className="size-4" />
        <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px]">
          {column.cards.length}
        </span>
        <span className="mt-1 [writing-mode:vertical-rl] text-xs font-medium">
          {column.title}
        </span>
      </button>
    );
  }

  return (
    <>
      <section
        className="flex h-full w-70 shrink-0 flex-col border-r border-border/70 pr-3"
        onMouseUp={() => dragging && onDrop(column._id)}
      >
        <header
          className="flex shrink-0 cursor-grab items-center gap-2 border-b border-border/70 px-1 pb-2 pt-1"
          onMouseDown={(event) => {
            if (
              event.button !== 0 ||
              (event.target as HTMLElement).closest("button,input")
            )
              return;
            const startX = event.clientX;
            const startY = event.clientY;
            const move = (moveEvent: MouseEvent) => {
              if (
                Math.abs(moveEvent.clientX - startX) > 5 ||
                Math.abs(moveEvent.clientY - startY) > 5
              ) {
                onColumnDragStart(column._id);
                window.removeEventListener("mousemove", move);
              }
            };
            window.addEventListener("mousemove", move, { once: true });
          }}
        >
          <span
            className="size-2 rounded-full"
            style={{ backgroundColor: column.color ?? "currentColor" }}
          />
          {editingTitle ? (
            <Input
              autoFocus
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onBlur={() => {
                if (title.trim())
                  onUpdateColumn(column._id, { title: title.trim() });
                setEditingTitle(false);
              }}
              className="h-6 flex-1 border-0 px-0 text-sm font-medium shadow-none"
            />
          ) : (
            <span
              className={`min-w-0 flex-1 truncate text-sm font-medium ${column.isDoneColumn ? "text-primary" : ""}`}
            >
              {column.title}
            </span>
          )}
          <span className="text-xs tabular-nums text-muted-foreground">
            {column.cards.length}
            {column.wipLimit ? `/${column.wipLimit}` : ""}
          </span>
          <button
            type="button"
            className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
            onClick={() => setAddingCard(true)}
            aria-label={`Add card to ${column.title}`}
          >
            <Plus className="size-3.5" />
          </button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                aria-label={`${column.title} options`}
              >
                <MoreHorizontal className="size-3.5" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => setEditingTitle(true)}>
                <Pencil className="mr-2 size-3.5" /> Rename
              </DropdownMenuItem>
              <DropdownMenuItem onClick={openCustomize}>
                <Palette className="mr-2 size-3.5" /> Customize
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() =>
                  onUpdateColumn(column._id, { isCollapsed: true })
                }
              >
                <PanelLeftClose className="mr-2 size-3.5" /> Collapse
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={!column.cards.length}
                onClick={() => setClearOpen(true)}
              >
                <Trash2 className="mr-2 size-3.5" /> Clear cards
              </DropdownMenuItem>
              <DropdownMenuItem
                className="text-destructive"
                onClick={() => onDeleteColumn(column._id)}
              >
                <Trash2 className="mr-2 size-3.5" /> Delete column
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </header>
        {column.description && (
          <p className="shrink-0 border-b border-border/50 px-1 py-2 text-xs leading-relaxed text-muted-foreground">
            {column.description}
          </p>
        )}
        <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto py-2 pr-1">
          {addingCard && (
            <div className="rounded-lg bg-card p-2 ring-1 ring-border/70">
              <Input
                autoFocus
                value={newCardTitle}
                onChange={(e) => setNewCardTitle(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") addCard();
                  if (e.key === "Escape") setAddingCard(false);
                }}
                placeholder="Card title…"
                className="h-8 text-sm"
              />
              <div className="mt-2 flex gap-1">
                <Button size="sm" onClick={addCard}>
                  Add
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setAddingCard(false)}
                >
                  Cancel
                </Button>
              </div>
            </div>
          )}
          {cards.map((card, index) => (
            <KanbanCardItem
              key={card._id}
              card={card}
              columnColor={column.color}
              isDoneColumn={column.isDoneColumn ?? false}
              nextCardId={cards[index + 1]?._id ?? null}
              isDraggingCard={dragging?.kind === "card"}
              manualSort={sortRule === "manual"}
              onDragStart={() => onCardDragStart(card._id, column._id)}
              onDragOver={(before) => onCardDragOver(column._id, before)}
              onDrop={() => onDrop(column._id)}
              onClick={() => onCardClick(card)}
            />
          ))}
          <div
            className="min-h-8 flex-1"
            onMouseEnter={() =>
              dragging?.kind === "card" && onCardDragOver(column._id, null)
            }
          />
        </div>
      </section>

      <Dialog open={customizeOpen} onOpenChange={setCustomizeOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base">Customize column</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>Description</Label>
              <Textarea
                value={editDescription}
                onChange={(e) => setEditDescription(e.target.value)}
                placeholder="What belongs in this column?"
                className="min-h-20"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Sort cards</Label>
                <Select
                  value={editSort}
                  onValueChange={(value) =>
                    setEditSort(value as typeof editSort)
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="manual">Manual</SelectItem>
                    <SelectItem value="priority">Priority</SelectItem>
                    <SelectItem value="dueDate">Due date</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>WIP limit</Label>
                <Input
                  type="number"
                  min={1}
                  value={editWip}
                  onChange={(e) => setEditWip(e.target.value)}
                  placeholder="No limit"
                />
              </div>
            </div>
            <div className="flex items-center justify-between rounded-lg bg-muted/50 px-3 py-2">
              <div>
                <Label htmlFor={`done-${column._id}`}>Done column</Label>
                <p className="text-xs text-muted-foreground">
                  Cards here count as complete.
                </p>
              </div>
              <Switch
                id={`done-${column._id}`}
                checked={editDone}
                onCheckedChange={setEditDone}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Color</Label>
              <ColumnColorPicker value={editColor} onChange={setEditColor} />
            </div>
            <div className="space-y-1.5">
              <Label>Icon</Label>
              <ColumnIconPicker
                value={editIcon}
                onChange={setEditIcon}
                color={editColor}
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setCustomizeOpen(false)}>
                Cancel
              </Button>
              <Button onClick={saveCustomize}>Save</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={clearOpen} onOpenChange={setClearOpen}>
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogTitle>Clear this column?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes every card from “{column.title}”.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => onClearColumn(column._id)}
            >
              Clear
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
