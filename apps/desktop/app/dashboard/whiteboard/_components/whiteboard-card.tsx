"use client";

import { format } from "date-fns";
import { Edit3, Trash2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import type { denizApi } from "@/lib/api-wrapper";
import type {
  IWhiteboard,
  IWhiteboardElement,
  IWhiteboardMeta,
} from "@/lib/data-types";
import { WhiteboardPreview } from "./whiteboard-preview";

interface WhiteboardCardProps {
  board: IWhiteboardMeta;
  api: denizApi;
  onRename: (board: IWhiteboardMeta) => void;
  onDelete: (board: IWhiteboardMeta) => void;
  onOpen: (id: string) => void;
}

export function WhiteboardCard({
  board,
  api,
  onRename,
  onDelete,
  onOpen,
}: WhiteboardCardProps) {
  const [elements, setElements] = useState<IWhiteboardElement[] | null>(null);
  const [elementCount, setElementCount] = useState<number | null>(null);
  const fetchedRef = useRef(false);

  const fetchPreview = useCallback(async () => {
    if (fetchedRef.current) return;
    fetchedRef.current = true;
    try {
      const result = await api.GET<{ whiteboard: IWhiteboard }>({
        endpoint: `whiteboard/${board._id}`,
      });
      if ("code" in result) return;
      setElements(result.whiteboard.elements ?? []);
      setElementCount(result.whiteboard.elements?.length ?? 0);
    } catch {}
  }, [api, board._id]);

  useEffect(() => {
    fetchPreview();
  }, [fetchPreview]);

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onOpen(board._id)}
      onKeyDown={(e) => e.key === "Enter" && onOpen(board._id)}
      className="group rounded-2xl border bg-card overflow-hidden cursor-pointer hover:shadow-md transition-all duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <WhiteboardPreview
        elements={elements}
        className="h-32 bg-[#f9f8f6] border-b"
      />

      <div className="p-3 flex flex-col">
        <p className="text-sm font-semibold leading-snug line-clamp-1">
          {board.name}
        </p>
        {elementCount !== null ? (
          <p className="text-xs text-muted-foreground mt-0.5">
            <span className="text-accent-strong font-semibold">
              {elementCount}
            </span>{" "}
            element{elementCount !== 1 ? "s" : ""}
          </p>
        ) : (
          <div className="h-3.5 w-16 bg-muted rounded animate-pulse mt-0.5" />
        )}
        <Separator className="mt-2" />
        <div className="flex flex-row items-baseline justify-between">
          <span className="text-xs text-muted-foreground mt-2">
            {format(new Date(board.updatedAt), "P p")}
          </span>
          <div className="flex items-center gap-2 mt-2">
            <Button
              variant={"outline"}
              size={"icon-xs"}
              onClick={(e) => {
                e.stopPropagation();
                onRename(board);
              }}
              title="Rename board"
            >
              <Edit3 />
            </Button>
            <Button
              variant={"destructive"}
              size={"icon-xs"}
              onClick={(e) => {
                e.stopPropagation();
                onDelete(board);
              }}
              title="Delete board"
            >
              <Trash2 />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
