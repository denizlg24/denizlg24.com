"use client";

import { DropdownMenuItem } from "@repo/ui/dropdown-menu";
import { ListRow } from "@repo/ui/list";
import { RowActions } from "@repo/ui/toolbar";
import { formatDistanceToNow } from "date-fns";
import { Edit3, PenTool, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import type { denizApi } from "@/lib/api-wrapper";
import type { IWhiteboard, IWhiteboardMeta } from "@/lib/data-types";

interface WhiteboardRowProps {
  board: IWhiteboardMeta;
  api: denizApi;
  onRename: (board: IWhiteboardMeta) => void;
  onDelete: (board: IWhiteboardMeta) => void;
  onOpen: (id: string) => void;
}

export function WhiteboardRow({
  board,
  api,
  onRename,
  onDelete,
  onOpen,
}: WhiteboardRowProps) {
  const [elementCount, setElementCount] = useState<number | null>(null);

  // The list route returns metadata only; the count needs the board itself.
  useEffect(() => {
    let cancelled = false;
    void api
      .GET<{ whiteboard: IWhiteboard }>({ endpoint: `whiteboard/${board._id}` })
      .then((result) => {
        if (cancelled || "code" in result) return;
        setElementCount(result.whiteboard.elements?.length ?? 0);
      });
    return () => {
      cancelled = true;
    };
  }, [api, board._id]);

  return (
    <ListRow
      leading={<PenTool />}
      title={board.name}
      onClick={() => onOpen(board._id)}
      meta={
        <>
          <span>{elementCount ?? "–"}</span>
          <span className="w-20 text-right">
            {formatDistanceToNow(new Date(board.updatedAt), {
              addSuffix: true,
            })}
          </span>
        </>
      }
      trailing={
        <RowActions>
          <DropdownMenuItem onSelect={() => onRename(board)}>
            <Edit3 />
            Rename
          </DropdownMenuItem>
          <DropdownMenuItem
            variant="destructive"
            onSelect={() => onDelete(board)}
          >
            <Trash2 />
            Delete
          </DropdownMenuItem>
        </RowActions>
      }
    />
  );
}
