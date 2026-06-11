"use client";

import { Plus, Trash2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { denizApi } from "@/lib/api-wrapper";
import type {
  IKanbanBoard,
  IKanbanCard,
  IKanbanColumn,
} from "@/lib/data-types";
import { CardDialog } from "./card-dialog";
import {
  COLUMN_COLORS,
  ColumnColorPicker,
  ColumnIconPicker,
} from "./column-customization";
import {
  type ColumnWithCards,
  type DraggingState,
  KanbanColumn,
} from "./kanban-column";

type FullBoard = IKanbanBoard & { columns: ColumnWithCards[] };
type KanbanCardUpdate = Omit<Partial<IKanbanCard>, "dueDate"> & {
  dueDate?: Date | string | null;
};
type EmptyApiResponse = Record<string, never>;

interface KanbanBoardProps {
  API: denizApi;
  boardId: string;
}

export function KanbanBoard({ API, boardId }: KanbanBoardProps) {
  const [columns, setColumns] = useState<ColumnWithCards[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedCard, setSelectedCard] = useState<IKanbanCard | null>(null);

  const [addingColumn, setAddingColumn] = useState(false);
  const [newColumnTitle, setNewColumnTitle] = useState("");
  const [newColumnColor, setNewColumnColor] = useState(COLUMN_COLORS[0]);
  const [newColumnIcon, setNewColumnIcon] = useState("circle");
  const [newColumnWipLimit, setNewColumnWipLimit] = useState("");

  const [dragging, setDragging] = useState<DraggingState | null>(null);
  const [trashHover, setTrashHover] = useState(false);
  const trashHoverRef = useRef(false);
  const draggingRef = useRef<DraggingState | null>(null);
  const mousePosRef = useRef({ x: 0, y: 0 });
  const ghostRef = useRef<HTMLDivElement>(null);
  const insertionPointRef = useRef<{
    columnId: string;
    beforeCardId: string | null;
  } | null>(null);

  useEffect(() => {
    draggingRef.current = dragging;
  }, [dragging]);

  useEffect(() => {
    const track = (e: MouseEvent) => {
      mousePosRef.current = { x: e.clientX, y: e.clientY };
    };
    window.addEventListener("mousemove", track);
    return () => window.removeEventListener("mousemove", track);
  }, []);

  useEffect(() => {
    if (!dragging) return;
    document.body.style.cursor = "grabbing";

    const handleMouseMove = (e: MouseEvent) => {
      if (ghostRef.current) {
        ghostRef.current.style.left = `${e.clientX + 14}px`;
        ghostRef.current.style.top = `${e.clientY + 10}px`;
      }
    };

    const handleMouseUp = () => {
      document.body.style.cursor = "";
      if (trashHoverRef.current && draggingRef.current) {
        const d = draggingRef.current;
        if (d.kind === "card") {
          handleDeleteCard(d.cardId);
        } else if (d.kind === "column") {
          handleDeleteColumn(d.columnId);
        }
        trashHoverRef.current = false;
        setTrashHover(false);
      }
      setDragging(null);
      insertionPointRef.current = null;
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      document.body.style.cursor = "";
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [dragging]);

  const fetchBoard = useCallback(async () => {
    const result = await API.GET<{ board: FullBoard }>({
      endpoint: `kanban/boards/${boardId}`,
    });
    if ("code" in result) return;
    const sorted = (result.board.columns ?? [])
      .sort((a, b) => a.order - b.order)
      .map((col) => ({
        ...col,
        cards: (col.cards ?? []).sort((a, b) => a.order - b.order),
      }));
    setColumns(sorted);
  }, [API, boardId]);

  useEffect(() => {
    fetchBoard().finally(() => setLoading(false));
  }, [fetchBoard]);

  const handleAddColumn = async () => {
    if (!newColumnTitle.trim()) return;
    const parsedWip = Number.parseInt(newColumnWipLimit, 10);
    const result = await API.POST<{ column: IKanbanColumn }>({
      endpoint: `kanban/boards/${boardId}/columns`,
      body: {
        title: newColumnTitle.trim(),
        color: newColumnColor,
        icon: newColumnIcon,
        ...(parsedWip > 0 ? { wipLimit: parsedWip } : {}),
      },
    });
    if ("code" in result) {
      toast.error("Failed to create column");
      return;
    }
    setColumns((prev) => [...prev, { ...result.column, cards: [] }]);
    setNewColumnTitle("");
    setNewColumnColor(COLUMN_COLORS[0]);
    setNewColumnIcon("circle");
    setNewColumnWipLimit("");
    setAddingColumn(false);
  };

  const handleUpdateColumn = async (
    columnId: string,
    updates: {
      title?: string;
      color?: string;
      icon?: string;
      wipLimit?: number | null;
    },
  ) => {
    const snapshot = columns.find((c) => c._id === columnId);
    setColumns((cols) =>
      cols.map((c) =>
        c._id === columnId
          ? {
              ...c,
              ...updates,
              wipLimit:
                updates.wipLimit === null
                  ? undefined
                  : (updates.wipLimit ?? c.wipLimit),
            }
          : c,
      ),
    );
    const result = await API.PATCH<EmptyApiResponse>({
      endpoint: `kanban/boards/${boardId}/columns/${columnId}`,
      body: updates,
    });
    if ("code" in result) {
      toast.error("Failed to update column");
      if (snapshot) {
        setColumns((cols) =>
          cols.map((c) =>
            c._id === columnId
              ? {
                  ...c,
                  title: snapshot.title,
                  color: snapshot.color,
                  icon: snapshot.icon,
                  wipLimit: snapshot.wipLimit,
                }
              : c,
          ),
        );
      }
    }
  };

  const handleDeleteColumn = async (columnId: string) => {
    setColumns((cols) => cols.filter((c) => c._id !== columnId));
    const result = await API.DELETE<EmptyApiResponse>({
      endpoint: `kanban/boards/${boardId}/columns/${columnId}`,
    });
    if ("code" in result) {
      toast.error("Failed to delete column");
      fetchBoard();
    }
  };

  const handleAddCard = async (columnId: string, title: string) => {
    const result = await API.POST<{ card: IKanbanCard }>({
      endpoint: `kanban/boards/${boardId}/cards`,
      body: { columnId, title, priority: "none" },
    });
    if ("code" in result) {
      toast.error("Failed to create card");
      return;
    }
    setColumns((cols) =>
      cols.map((col) =>
        col._id === columnId
          ? { ...col, cards: [...col.cards, result.card] }
          : col,
      ),
    );
  };

  const handleUpdateCard = async (
    cardId: string,
    updates: KanbanCardUpdate,
  ) => {
    const result = await API.PATCH<{ card: IKanbanCard }>({
      endpoint: `kanban/boards/${boardId}/cards/${cardId}`,
      body: updates,
    });
    if ("code" in result) {
      toast.error("Failed to update card");
      return;
    }

    const updatedCard = result.card;

    if (updates.columnId) {
      fetchBoard();
    } else {
      setColumns((cols) =>
        cols.map((col) => ({
          ...col,
          cards: col.cards.map((c) =>
            c._id === cardId ? { ...c, ...updatedCard } : c,
          ),
        })),
      );
    }
    setSelectedCard((prev) =>
      prev?._id === cardId ? { ...prev, ...updatedCard } : prev,
    );
  };

  const handleClearColumn = async (columnId: string) => {
    const snapshot = columns.find((c) => c._id === columnId);
    setColumns((cols) =>
      cols.map((col) => (col._id === columnId ? { ...col, cards: [] } : col)),
    );
    const result = await API.DELETE<{ deletedCount: number }>({
      endpoint: `kanban/boards/${boardId}/columns/${columnId}/cards`,
    });
    if ("code" in result) {
      toast.error("Failed to clear column");
      if (snapshot) {
        setColumns((cols) =>
          cols.map((col) => (col._id === columnId ? snapshot : col)),
        );
      } else {
        fetchBoard();
      }
    }
  };

  const handleToggleCardDone = async (card: IKanbanCard) => {
    const isDone = card.labels.some((label) => label.toLowerCase() === "done");
    if (isDone) {
      await handleUpdateCard(card._id, {
        labels: card.labels.filter((label) => label.toLowerCase() !== "done"),
      });
      return;
    }

    const doneColumn = columns.find(
      (col) => col.title.trim().toLowerCase() === "done",
    );
    await handleUpdateCard(card._id, {
      labels: [...card.labels, "done"],
      dueDate: null,
      ...(doneColumn && doneColumn._id !== card.columnId
        ? { columnId: doneColumn._id, order: doneColumn.cards.length }
        : {}),
    });
  };

  const handleDeleteCard = async (cardId: string) => {
    const result = await API.DELETE<EmptyApiResponse>({
      endpoint: `kanban/boards/${boardId}/cards/${cardId}`,
    });
    if ("code" in result) {
      toast.error("Failed to delete card");
      return;
    }
    setColumns((cols) =>
      cols.map((col) => ({
        ...col,
        cards: col.cards.filter((c) => c._id !== cardId),
      })),
    );
  };

  const handleCardDragStart = (cardId: string, fromColumnId: string) => {
    setDragging({ kind: "card", cardId, fromColumnId });
  };

  const handleColumnDragStart = (columnId: string) => {
    setDragging({ kind: "column", columnId });
  };

  const handleCardDragOver = (
    columnId: string,
    beforeCardId: string | null,
  ) => {
    if (dragging?.kind !== "card") return;
    insertionPointRef.current = { columnId, beforeCardId };
  };

  const handleDrop = async (targetColumnId: string) => {
    if (!dragging) return;
    const currentDragging = dragging;
    setDragging(null);
    document.body.style.cursor = "";

    if (currentDragging.kind === "card") {
      const { cardId } = currentDragging;
      const ip = insertionPointRef.current;
      const before =
        ip !== null && ip.columnId === targetColumnId ? ip.beforeCardId : null;
      insertionPointRef.current = null;

      const newCols = columns.map((col) => ({ ...col, cards: [...col.cards] }));

      let movedCard: IKanbanCard | undefined;
      for (const col of newCols) {
        const idx = col.cards.findIndex((c) => c._id === cardId);
        if (idx !== -1) {
          [movedCard] = col.cards.splice(idx, 1);
          break;
        }
      }
      if (!movedCard) return;

      movedCard = { ...movedCard, columnId: targetColumnId };
      const targetCol = newCols.find((c) => c._id === targetColumnId);
      if (!targetCol) return;

      if (before) {
        const beforeIdx = targetCol.cards.findIndex((c) => c._id === before);
        targetCol.cards.splice(
          beforeIdx !== -1 ? beforeIdx : targetCol.cards.length,
          0,
          movedCard,
        );
      } else {
        targetCol.cards.push(movedCard);
      }

      for (const col of newCols) {
        col.cards = col.cards.map((c, i) => ({ ...c, order: i }));
      }

      setColumns(newCols);

      const allCards = newCols.flatMap((col) =>
        col.cards.map((c) => ({
          _id: c._id,
          order: c.order,
          columnId: col._id,
        })),
      );

      const result = await API.PATCH<EmptyApiResponse>({
        endpoint: `kanban/boards/${boardId}/cards/reorder`,
        body: { items: allCards },
      });
      if ("code" in result) {
        toast.error("Failed to reorder cards");
        fetchBoard();
      }
    } else if (currentDragging.kind === "column") {
      const { columnId: fromCol } = currentDragging;
      insertionPointRef.current = null;
      if (fromCol === targetColumnId) return;

      const newCols = [...columns];
      const fromIdx = newCols.findIndex((c) => c._id === fromCol);
      const toIdx = newCols.findIndex((c) => c._id === targetColumnId);
      if (fromIdx === -1 || toIdx === -1) return;

      const [moved] = newCols.splice(fromIdx, 1);
      newCols.splice(toIdx, 0, moved);
      const reordered = newCols.map((col, i) => ({ ...col, order: i }));

      setColumns(reordered);

      const result = await API.PATCH<EmptyApiResponse>({
        endpoint: `kanban/boards/${boardId}/columns/reorder`,
        body: {
          items: reordered.map((c) => ({ _id: c._id, order: c.order })),
        },
      });
      if ("code" in result) {
        toast.error("Failed to reorder columns");
        fetchBoard();
      }
    }
  };

  if (loading) {
    const CARD_COUNTS = [3, 5, 2];
    return (
      <div className="flex gap-4 p-4 h-full items-start w-full">
        {CARD_COUNTS.map((cardCount, i) => (
          <div
            key={`column-skeleton-${cardCount}`}
            className="min-w-64 flex-1 flex flex-col rounded-lg border bg-muted/30 animate-pulse"
          >
            <div className="flex items-center gap-2 p-3 border-b">
              <div className="size-4 rounded bg-muted" />
              <div className="h-4 flex-1 rounded bg-muted" />
              <div className="h-3 w-4 rounded bg-muted" />
            </div>

            <div className="flex flex-col gap-2 p-2">
              {Array.from({ length: cardCount }).map((_, j) => (
                <div
                  key={`card-skeleton-${cardCount}-${60 + ((i * 3 + j * 7) % 30)}`}
                  className="flex flex-col gap-2 p-3 rounded-md border bg-card"
                >
                  <div
                    className="h-3.5 rounded bg-muted"
                    style={{ width: `${60 + ((i * 3 + j * 7) % 30)}%` }}
                  />
                  {j % 2 === 0 && (
                    <div className="h-3 w-3/4 rounded bg-muted" />
                  )}
                </div>
              ))}
            </div>

            <div className="p-2 border-t">
              <div className="h-7 w-24 rounded bg-muted" />
            </div>
          </div>
        ))}

        <div className="shrink-0">
          <div className="h-9 w-32 rounded bg-muted" />
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="flex gap-4 p-4 h-full items-start w-full max-w-[calc(100vw-32rem)]">
        {columns.map((col) => (
          <KanbanColumn
            key={col._id}
            column={col}
            dragging={dragging}
            onCardDragStart={handleCardDragStart}
            onColumnDragStart={handleColumnDragStart}
            onCardDragOver={handleCardDragOver}
            onDrop={handleDrop}
            onCardClick={setSelectedCard}
            onAddCard={handleAddCard}
            onUpdateColumn={handleUpdateColumn}
            onDeleteColumn={handleDeleteColumn}
            onClearColumn={handleClearColumn}
            onToggleCardDone={handleToggleCardDone}
          />
        ))}

        <div className="shrink-0 min-w-64">
          {addingColumn ? (
            <div className="flex flex-col gap-3 p-3 bg-muted/50 rounded-lg border border-dashed">
              <Input
                autoFocus
                value={newColumnTitle}
                onChange={(e) => setNewColumnTitle(e.target.value)}
                placeholder="Column title…"
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleAddColumn();
                  if (e.key === "Escape") {
                    setAddingColumn(false);
                    setNewColumnTitle("");
                    setNewColumnColor(COLUMN_COLORS[0]);
                    setNewColumnIcon("circle");
                    setNewColumnWipLimit("");
                  }
                }}
              />
              <div className="flex flex-col gap-1.5">
                <Label className="text-xs text-muted-foreground">
                  WIP Limit <span className="font-normal">(optional)</span>
                </Label>
                <Input
                  type="number"
                  min={1}
                  value={newColumnWipLimit}
                  onChange={(e) => setNewColumnWipLimit(e.target.value)}
                  placeholder="No limit"
                  className="h-8"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label className="text-xs text-muted-foreground">Color</Label>
                <ColumnColorPicker
                  value={newColumnColor}
                  onChange={setNewColumnColor}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label className="text-xs text-muted-foreground">Icon</Label>
                <ColumnIconPicker
                  value={newColumnIcon}
                  onChange={setNewColumnIcon}
                  color={newColumnColor}
                />
              </div>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  onClick={handleAddColumn}
                  disabled={!newColumnTitle.trim()}
                >
                  Add
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setAddingColumn(false);
                    setNewColumnTitle("");
                    setNewColumnColor(COLUMN_COLORS[0]);
                    setNewColumnIcon("circle");
                    setNewColumnWipLimit("");
                  }}
                >
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <Button
              variant="ghost"
              className="w-full justify-start text-muted-foreground"
              onClick={() => setAddingColumn(true)}
            >
              <Plus />
              Add column
            </Button>
          )}
        </div>
      </div>

      {selectedCard && (
        <CardDialog
          card={selectedCard}
          columns={columns}
          onClose={() => setSelectedCard(null)}
          onUpdate={handleUpdateCard}
          onDelete={handleDeleteCard}
        />
      )}

      {createPortal(
        <div
          className={`fixed bottom-6 right-6 z-9999 flex items-center justify-center rounded-2xl border-2 border-dashed transition-all duration-200 ${
            dragging
              ? "opacity-100 scale-100"
              : "opacity-0 scale-75 pointer-events-none"
          } ${
            trashHover
              ? "border-destructive bg-destructive/15 text-destructive scale-110"
              : "border-muted-foreground/40 bg-background/80 text-muted-foreground backdrop-blur-sm"
          } size-14`}
          onMouseEnter={() => {
            trashHoverRef.current = true;
            setTrashHover(true);
          }}
          onMouseLeave={() => {
            trashHoverRef.current = false;
            setTrashHover(false);
          }}
        >
          <Trash2
            className={`transition-all duration-200 ${trashHover ? "size-6" : "size-5"}`}
          />
        </div>,
        document.body,
      )}

      {dragging &&
        (() => {
          const pos = mousePosRef.current;

          if (dragging.kind === "card") {
            const card = columns
              .flatMap((c) => c.cards)
              .find((c) => c._id === dragging.cardId);
            if (!card) return null;
            return (
              <div
                ref={ghostRef}
                className="fixed z-50 pointer-events-none w-64 opacity-75"
                style={{ left: pos.x - 128, top: pos.y - 20 }}
              >
                <div className="bg-card rounded-xl border shadow-2xl p-4 select-none">
                  {card.labels && card.labels.length > 0 && (
                    <div className="flex gap-1.5 flex-wrap mb-2.5">
                      {card.labels.slice(0, 3).map((label) => (
                        <span
                          key={label}
                          className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-primary/10 text-primary leading-none"
                        >
                          {label}
                        </span>
                      ))}
                    </div>
                  )}
                  <p className="text-sm font-semibold leading-snug text-foreground line-clamp-2">
                    {card.title}
                  </p>
                  {card.description && (
                    <p className="text-xs text-muted-foreground line-clamp-1 mt-1.5 leading-relaxed">
                      {card.description}
                    </p>
                  )}
                </div>
              </div>
            );
          }

          if (dragging.kind === "column") {
            const col = columns.find((c) => c._id === dragging.columnId);
            if (!col) return null;
            return (
              <div
                ref={ghostRef}
                className="fixed z-50 pointer-events-none w-64 opacity-75"
                style={{ left: pos.x - 128, top: pos.y - 20 }}
              >
                <div className="bg-secondary/80 dark:bg-muted/60 rounded-2xl border shadow-2xl px-4 py-3 flex items-center gap-2">
                  <span className="text-sm font-medium flex-1 truncate">
                    {col.title}
                  </span>
                  <span className="text-xs text-muted-foreground bg-background rounded-full px-2 py-0.5 font-medium">
                    {col.cards.length}
                  </span>
                </div>
              </div>
            );
          }

          return null;
        })()}
    </>
  );
}
