"use client";

import { Button } from "@repo/ui/button";
import { ConfirmDialog } from "@repo/ui/confirm-button";
import {
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@repo/ui/dropdown-menu";
import { Input } from "@repo/ui/input";
import { RowActions } from "@repo/ui/toolbar";
import { cn } from "@repo/ui/utils";
import {
  ChevronsRight,
  Eraser,
  PanelLeftClose,
  Pencil,
  Plus,
  Settings2,
  Trash2,
} from "lucide-react";
import { Fragment, useMemo, useState } from "react";
import type { IKanbanCard, IKanbanColumn } from "@/lib/data-types";
import {
  ColumnDialog,
  type ColumnFormValues,
  resolveColumnIcon,
} from "./column-customization";
import { KanbanCardItem } from "./kanban-card-item";

export type ColumnWithCards = IKanbanColumn & { cards: IKanbanCard[] };
export type DraggingState =
  | { kind: "card"; cardId: string; fromColumnId: string }
  | { kind: "column"; columnId: string };

export type ColumnUpdates = Partial<ColumnFormValues> & {
  isCollapsed?: boolean;
};

interface Props {
  column: ColumnWithCards;
  dragging: DraggingState | null;
  /** Where a dragged card would land in this column; undefined when not here. */
  dropBeforeCardId: string | null | undefined;
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

function DropLine() {
  return <div className="-my-1 h-0.5 shrink-0 rounded-full bg-ring" />;
}

export function KanbanColumn({
  column,
  dragging,
  dropBeforeCardId,
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
  const [deleteOpen, setDeleteOpen] = useState(false);

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

  const Icon = resolveColumnIcon(column.icon);
  const overLimit =
    column.wipLimit !== undefined && column.cards.length > column.wipLimit;
  const draggingCardId = dragging?.kind === "card" ? dragging.cardId : null;

  const addCard = () => {
    if (!newCardTitle.trim()) return;
    onAddCard(column._id, newCardTitle.trim());
    setNewCardTitle("");
  };

  const startRename = () => {
    setTitle(column.title);
    setEditingTitle(true);
  };

  const commitRename = () => {
    const next = title.trim();
    if (next && next !== column.title)
      onUpdateColumn(column._id, { title: next });
    setEditingTitle(false);
  };

  const dialogs = (
    <>
      <ColumnDialog
        open={customizeOpen}
        onOpenChange={setCustomizeOpen}
        column={column}
        onSubmit={(values) => onUpdateColumn(column._id, values)}
      />
      <ConfirmDialog
        open={clearOpen}
        onOpenChange={setClearOpen}
        title={`Clear ${column.title}?`}
        description={`${column.cards.length} cards will be deleted.`}
        actionLabel="Clear"
        destructive
        onConfirm={() => onClearColumn(column._id)}
      />
      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title={`Delete ${column.title}?`}
        description={
          column.cards.length
            ? `${column.cards.length} cards will be deleted with it.`
            : undefined
        }
        actionLabel="Delete"
        destructive
        onConfirm={() => onDeleteColumn(column._id)}
      />
    </>
  );

  if (column.isCollapsed) {
    return (
      <>
        <button
          type="button"
          className="flex h-full w-10 shrink-0 flex-col items-center gap-3 rounded-lg bg-surface/40 py-3 text-muted-foreground transition-colors hover:bg-surface/70 hover:text-accent-strong"
          onClick={() => onUpdateColumn(column._id, { isCollapsed: false })}
          onMouseUp={() => dragging?.kind === "card" && onDrop(column._id)}
          aria-label={`Expand ${column.title}`}
        >
          <ChevronsRight className="size-4" />
          <span className="text-xs tabular-nums">{column.cards.length}</span>
          <span className="mt-1 text-xs font-medium [writing-mode:vertical-rl]">
            {column.title}
          </span>
        </button>
        {dialogs}
      </>
    );
  }

  return (
    <>
      <section
        className={cn(
          "flex h-full w-72 shrink-0 flex-col rounded-lg bg-surface/40 dark:bg-surface/25",
          dragging?.kind === "column" &&
            dragging.columnId === column._id &&
            "opacity-40",
        )}
        onMouseUp={() => dragging && onDrop(column._id)}
      >
        <header
          className="flex h-10 shrink-0 cursor-grab items-center gap-2 px-3 active:cursor-grabbing"
          onMouseDown={(event) => {
            if (
              event.button !== 0 ||
              !(event.target instanceof Element) ||
              event.target.closest("button,input")
            )
              return;
            const startX = event.clientX;
            const startY = event.clientY;
            const move = (moveEvent: MouseEvent) => {
              if (
                Math.abs(moveEvent.clientX - startX) > 5 ||
                Math.abs(moveEvent.clientY - startY) > 5
              ) {
                cleanup();
                onColumnDragStart(column._id);
              }
            };
            const cleanup = () => {
              window.removeEventListener("mousemove", move);
              window.removeEventListener("mouseup", cleanup);
            };
            window.addEventListener("mousemove", move);
            window.addEventListener("mouseup", cleanup);
          }}
        >
          <Icon
            className="size-3.5 shrink-0"
            style={{ color: column.color ?? undefined }}
          />
          {editingTitle ? (
            <Input
              autoFocus
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onBlur={commitRename}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitRename();
                if (e.key === "Escape") setEditingTitle(false);
              }}
              className="h-7 flex-1 px-1.5 text-sm"
            />
          ) : (
            <span
              onDoubleClick={startRename}
              className="min-w-0 truncate text-sm font-medium text-accent-strong"
            >
              {column.title}
            </span>
          )}
          <span
            className={cn(
              "text-xs tabular-nums text-muted-foreground",
              overLimit && "font-medium text-status-critical",
            )}
          >
            {column.cards.length}
            {column.wipLimit ? `/${column.wipLimit}` : ""}
          </span>
          <span className="flex-1" />
          <Button
            variant="ghost"
            size="icon-xs"
            className="text-muted-foreground"
            onClick={() => setAddingCard(true)}
            aria-label={`Add card to ${column.title}`}
          >
            <Plus />
          </Button>
          <RowActions label={`${column.title} options`}>
            <DropdownMenuItem onClick={startRename}>
              <Pencil /> Rename
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setCustomizeOpen(true)}>
              <Settings2 /> Edit
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => onUpdateColumn(column._id, { isCollapsed: true })}
            >
              <PanelLeftClose /> Collapse
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              disabled={!column.cards.length}
              onClick={() => setClearOpen(true)}
            >
              <Eraser /> Clear cards
            </DropdownMenuItem>
            <DropdownMenuItem
              variant="destructive"
              onClick={() => setDeleteOpen(true)}
            >
              <Trash2 /> Delete
            </DropdownMenuItem>
          </RowActions>
        </header>
        {column.description && (
          <p className="shrink-0 px-3 pb-2 text-xs leading-relaxed text-muted-foreground">
            {column.description}
          </p>
        )}
        <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-2 pb-2">
          {addingCard && (
            <Input
              autoFocus
              value={newCardTitle}
              onChange={(e) => setNewCardTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") addCard();
                if (e.key === "Escape") {
                  setNewCardTitle("");
                  setAddingCard(false);
                }
              }}
              onBlur={() => {
                if (!newCardTitle.trim()) setAddingCard(false);
              }}
              placeholder="Title"
              className="shrink-0 bg-background"
            />
          )}
          {cards.map((card, index) => (
            <Fragment key={card._id}>
              {dropBeforeCardId === card._id && <DropLine />}
              <KanbanCardItem
                card={card}
                isDoneColumn={column.isDoneColumn ?? false}
                nextCardId={cards[index + 1]?._id ?? null}
                isDraggingCard={draggingCardId !== null}
                isDragged={draggingCardId === card._id}
                manualSort={sortRule === "manual"}
                onDragStart={() => onCardDragStart(card._id, column._id)}
                onDragOver={(before) => onCardDragOver(column._id, before)}
                onDrop={() => onDrop(column._id)}
                onClick={() => onCardClick(card)}
              />
            </Fragment>
          ))}
          {dropBeforeCardId === null && <DropLine />}
          <div
            className="min-h-8 flex-1"
            onMouseMove={() =>
              draggingCardId !== null && onCardDragOver(column._id, null)
            }
          />
        </div>
      </section>
      {dialogs}
    </>
  );
}
