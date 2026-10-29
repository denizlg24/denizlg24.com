"use client";

import { Badge } from "@repo/ui/badge";
import { Button } from "@repo/ui/button";
import { ConfirmDialog } from "@repo/ui/confirm-button";
import { EmptyState } from "@repo/ui/empty-state";
import { Skeleton } from "@repo/ui/skeleton";
import { cn } from "@repo/ui/utils";
import { Columns3, Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import type { denizApi } from "@/lib/api-wrapper";
import type {
  IKanbanBoard,
  IKanbanCard,
  IKanbanColumn,
} from "@/lib/data-types";
import { ColumnDialog, type ColumnFormValues } from "./column-customization";
import { PRIORITY_BADGE } from "./kanban-card-item";
import {
  type ColumnUpdates,
  type ColumnWithCards,
  type DraggingState,
  KanbanColumn,
} from "./kanban-column";

type InsertionPoint = { columnId: string; beforeCardId: string | null };

const GHOST_OFFSET = { x: 14, y: 10 };

type FullBoard = IKanbanBoard & { columns: ColumnWithCards[] };
type EmptyApiResponse = Record<string, never>;

interface KanbanBoardProps {
  API: denizApi;
  boardId: string;
}

export function KanbanBoard({ API, boardId }: KanbanBoardProps) {
  const router = useRouter();
  const [columns, setColumns] = useState<ColumnWithCards[]>([]);
  const [loading, setLoading] = useState(true);

  const [addingColumn, setAddingColumn] = useState(false);
  const [trashedColumnId, setTrashedColumnId] = useState<string | null>(null);

  const [dragging, setDragging] = useState<DraggingState | null>(null);
  const [trashHover, setTrashHover] = useState(false);
  const trashHoverRef = useRef(false);
  const draggingRef = useRef<DraggingState | null>(null);
  const mousePosRef = useRef({ x: 0, y: 0 });
  const ghostRef = useRef<HTMLDivElement>(null);
  const insertionPointRef = useRef<InsertionPoint | null>(null);
  const [insertionPoint, setInsertionPointState] =
    useState<InsertionPoint | null>(null);

  const setInsertionPoint = useCallback((next: InsertionPoint | null) => {
    const current = insertionPointRef.current;
    if (
      current?.columnId === next?.columnId &&
      current?.beforeCardId === next?.beforeCardId
    )
      return;
    insertionPointRef.current = next;
    setInsertionPointState(next);
  }, []);

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
        ghostRef.current.style.left = `${e.clientX + GHOST_OFFSET.x}px`;
        ghostRef.current.style.top = `${e.clientY + GHOST_OFFSET.y}px`;
      }
    };

    const handleMouseUp = () => {
      document.body.style.cursor = "";
      if (trashHoverRef.current && draggingRef.current) {
        const d = draggingRef.current;
        if (d.kind === "card") {
          handleDeleteCard(d.cardId);
        } else if (d.kind === "column") {
          setTrashedColumnId(d.columnId);
        }
        trashHoverRef.current = false;
        setTrashHover(false);
      }
      setDragging(null);
      setInsertionPoint(null);
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      document.body.style.cursor = "";
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [dragging, setInsertionPoint]);

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

  const handleAddColumn = async (values: ColumnFormValues) => {
    const result = await API.POST<{ column: IKanbanColumn }>({
      endpoint: `kanban/boards/${boardId}/columns`,
      body: {
        title: values.title,
        description: values.description || undefined,
        color: values.color,
        icon: values.icon,
        isDoneColumn: values.isDoneColumn,
        sortRule: values.sortRule,
        ...(values.wipLimit ? { wipLimit: values.wipLimit } : {}),
      },
    });
    if ("code" in result) {
      toast.error("Failed to create column");
      return;
    }
    if (values.isDoneColumn) {
      await fetchBoard();
      return;
    }
    setColumns((prev) => [...prev, { ...result.column, cards: [] }]);
  };

  const handleUpdateColumn = async (
    columnId: string,
    updates: ColumnUpdates,
  ) => {
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
          : updates.isDoneColumn
            ? { ...c, isDoneColumn: false }
            : c,
      ),
    );
    const result = await API.PATCH<EmptyApiResponse>({
      endpoint: `kanban/boards/${boardId}/columns/${columnId}`,
      body: updates,
    });
    if ("code" in result) {
      toast.error("Failed to update column");
      fetchBoard();
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
    setInsertionPoint({ columnId, beforeCardId });
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
      setInsertionPoint(null);

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

      if ((targetCol.sortRule ?? "manual") !== "manual") {
        targetCol.cards.push(movedCard);
        setColumns(newCols);
        const result = await API.PATCH<{ card: IKanbanCard }>({
          endpoint: `kanban/boards/${boardId}/cards/${cardId}`,
          body: { columnId: targetColumnId },
        });
        if ("code" in result) {
          toast.error("Failed to move card");
          fetchBoard();
        }
        return;
      }

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
      setInsertionPoint(null);
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
    return (
      <div className="flex h-full items-stretch gap-3 p-3">
        {[3, 5, 2].map((cardCount) => (
          <div
            key={cardCount}
            className="flex w-72 shrink-0 flex-col gap-2 rounded-lg bg-surface/40 p-2"
          >
            <div className="flex h-8 items-center gap-2 px-1">
              <Skeleton className="size-3.5 rounded-full" />
              <Skeleton className="h-3.5 w-24" />
              <Skeleton className="h-3 w-4" />
            </div>
            {Array.from(
              { length: cardCount },
              (_, j) => `${cardCount}-${j}`,
            ).map((key, j) => (
              <div
                key={key}
                className="flex flex-col gap-2 rounded-md border border-border/70 bg-background px-3 py-2.5"
              >
                <Skeleton className={j % 2 ? "h-3.5 w-2/3" : "h-3.5 w-4/5"} />
                {j % 2 === 0 && <Skeleton className="h-3 w-1/2" />}
              </div>
            ))}
          </div>
        ))}
      </div>
    );
  }

  const trashedColumn = columns.find((c) => c._id === trashedColumnId);

  return (
    <>
      {columns.length === 0 ? (
        <EmptyState
          icon={<Columns3 />}
          label="No columns"
          action={
            <Button size="sm" onClick={() => setAddingColumn(true)}>
              <Plus /> Add column
            </Button>
          }
          className="h-full"
        />
      ) : (
        <div className="h-full overflow-x-auto">
          <div className="flex h-full w-max min-w-full items-stretch gap-3 p-3">
            {columns.map((col) => (
              <KanbanColumn
                key={col._id}
                column={col}
                dragging={dragging}
                dropBeforeCardId={
                  insertionPoint?.columnId === col._id
                    ? insertionPoint.beforeCardId
                    : undefined
                }
                onCardDragStart={handleCardDragStart}
                onColumnDragStart={handleColumnDragStart}
                onCardDragOver={handleCardDragOver}
                onDrop={handleDrop}
                onCardClick={(card) =>
                  router.push(
                    `/dashboard/kanban/card?board=${encodeURIComponent(boardId)}&card=${encodeURIComponent(card._id)}`,
                  )
                }
                onAddCard={handleAddCard}
                onUpdateColumn={handleUpdateColumn}
                onDeleteColumn={handleDeleteColumn}
                onClearColumn={handleClearColumn}
              />
            ))}
            <div className="w-56 shrink-0">
              <Button
                variant="ghost"
                size="sm"
                className="w-full justify-start text-muted-foreground"
                onClick={() => setAddingColumn(true)}
              >
                <Plus /> Add column
              </Button>
            </div>
          </div>
        </div>
      )}

      <ColumnDialog
        open={addingColumn}
        onOpenChange={setAddingColumn}
        onSubmit={handleAddColumn}
      />

      <ConfirmDialog
        open={trashedColumn !== undefined}
        onOpenChange={(open) => !open && setTrashedColumnId(null)}
        title={`Delete ${trashedColumn?.title ?? "column"}?`}
        description={
          trashedColumn?.cards.length
            ? `${trashedColumn.cards.length} cards will be deleted with it.`
            : undefined
        }
        actionLabel="Delete"
        destructive
        onConfirm={() => {
          if (trashedColumnId) handleDeleteColumn(trashedColumnId);
          setTrashedColumnId(null);
        }}
      />

      {createPortal(
        <div
          className={cn(
            "fixed right-6 bottom-6 z-50 flex size-14 items-center justify-center rounded-xl border border-dashed transition-all duration-200",
            dragging
              ? "scale-100 opacity-100"
              : "pointer-events-none scale-75 opacity-0",
            trashHover
              ? "scale-110 border-destructive bg-destructive/15 text-destructive"
              : "border-border bg-background/90 text-muted-foreground backdrop-blur-sm",
          )}
          onMouseEnter={() => {
            trashHoverRef.current = true;
            setTrashHover(true);
          }}
          onMouseLeave={() => {
            trashHoverRef.current = false;
            setTrashHover(false);
          }}
        >
          <Trash2 className={trashHover ? "size-6" : "size-5"} />
        </div>,
        document.body,
      )}

      {dragging &&
        (() => {
          const pos = mousePosRef.current;
          const ghostStyle = {
            left: pos.x + GHOST_OFFSET.x,
            top: pos.y + GHOST_OFFSET.y,
          };

          if (dragging.kind === "card") {
            const card = columns
              .flatMap((c) => c.cards)
              .find((c) => c._id === dragging.cardId);
            if (!card) return null;
            const priority = PRIORITY_BADGE[card.priority];
            return (
              <div
                ref={ghostRef}
                className="pointer-events-none fixed z-50 w-72 rotate-1 select-none"
                style={ghostStyle}
              >
                <div className="flex flex-col gap-1.5 rounded-md border bg-background px-3 py-2.5 shadow-lg">
                  {card.labels.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {card.labels.slice(0, 3).map((label) => (
                        <Badge key={label} variant="secondary">
                          {label}
                        </Badge>
                      ))}
                    </div>
                  )}
                  <p className="line-clamp-2 text-sm leading-snug text-accent-strong">
                    {card.title}
                  </p>
                  {priority && (
                    <Badge variant={priority.variant} className="self-end">
                      {priority.label}
                    </Badge>
                  )}
                </div>
              </div>
            );
          }

          const col = columns.find((c) => c._id === dragging.columnId);
          if (!col) return null;
          return (
            <div
              ref={ghostRef}
              className="pointer-events-none fixed z-50 w-72 select-none"
              style={ghostStyle}
            >
              <div className="flex h-10 items-center gap-2 rounded-lg border bg-background px-3 shadow-lg">
                <span className="flex-1 truncate text-sm font-medium text-accent-strong">
                  {col.title}
                </span>
                <span className="text-xs tabular-nums text-muted-foreground">
                  {col.cards.length}
                </span>
              </div>
            </div>
          );
        })()}
    </>
  );
}
