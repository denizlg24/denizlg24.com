"use client";

import { Button } from "@repo/ui/button";
import { ConfirmDialog } from "@repo/ui/confirm-button";
import {
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@repo/ui/dropdown-menu";
import { EmptyState } from "@repo/ui/empty-state";
import { FormDialog, FormField, FormGrid } from "@repo/ui/form-dialog";
import { Input } from "@repo/ui/input";
import { List, ListRow } from "@repo/ui/list";
import { Page, PageBody, PageToolbar } from "@repo/ui/page";
import { Skeleton } from "@repo/ui/skeleton";
import { Textarea } from "@repo/ui/textarea";
import { RowActions, SearchField } from "@repo/ui/toolbar";
import { cn } from "@repo/ui/utils";
import { LayoutGrid, Pencil, Plus, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { DashboardPageHeader } from "@/components/navigation/dashboard-page-header";
import { useUserSettings } from "@/context/user-context";
import { denizApi } from "@/lib/api-wrapper";
import type { IKanbanBoard } from "@/lib/data-types";
import { SwatchPicker } from "./_components/column-customization";
import { KanbanBoard } from "./_components/kanban-board";

const BOARD_COLORS = [
  "#6366f1",
  "#8b5cf6",
  "#ec4899",
  "#ef4444",
  "#f97316",
  "#eab308",
  "#a1bc98",
  "#14b8a6",
  "#3b82f6",
  "#64748b",
];

interface KanbanTemplate {
  id: string;
  name: string;
  color: string;
  columns: string[];
}

const TEMPLATES: KanbanTemplate[] = [
  { id: "blank", name: "Blank", color: "#64748b", columns: [] },
  {
    id: "software",
    name: "Software",
    color: "#6366f1",
    columns: ["Backlog", "To Do", "In Progress", "In Review", "Done"],
  },
  {
    id: "personal",
    name: "Personal",
    color: "#a1bc98",
    columns: ["To Do", "In Progress", "Done"],
  },
  {
    id: "content",
    name: "Content",
    color: "#ec4899",
    columns: ["Ideas", "Writing", "In Review", "Published"],
  },
  {
    id: "bugs",
    name: "Bugs",
    color: "#ef4444",
    columns: ["Reported", "Triaged", "In Progress", "Fixed", "Closed"],
  },
  {
    id: "marketing",
    name: "Marketing",
    color: "#f97316",
    columns: ["Planning", "Design", "In Review", "Launched"],
  },
];

function relativeTime(value: Date | string): string {
  const date = new Date(value);
  const minutes = Math.floor((Date.now() - date.getTime()) / 60_000);
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return date.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

function BoardDot({ color }: { color?: string }) {
  return (
    <span
      className="size-2.5 rounded-full bg-muted-foreground/40"
      style={color ? { backgroundColor: color } : undefined}
    />
  );
}

function TemplatePicker({
  selected,
  onSelect,
}: {
  selected: string;
  onSelect: (template: KanbanTemplate) => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
      {TEMPLATES.map((template) => (
        <button
          key={template.id}
          type="button"
          aria-pressed={selected === template.id}
          onClick={() => onSelect(template)}
          className={cn(
            "flex flex-col gap-1.5 rounded-md border px-3 py-2.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
            selected === template.id
              ? "border-ring/60 bg-surface dark:bg-muted"
              : "border-border/70 hover:bg-surface/70",
          )}
        >
          <span className="flex items-center gap-2 text-sm text-accent-strong">
            <BoardDot color={template.color} />
            {template.name}
          </span>
          <span className="truncate text-xs text-muted-foreground">
            {template.columns.length ? template.columns.join(" · ") : "—"}
          </span>
        </button>
      ))}
    </div>
  );
}

type BoardDraft = {
  title: string;
  description: string;
  color: string;
  template: string;
};

const EMPTY_DRAFT: BoardDraft = {
  title: "",
  description: "",
  color: BOARD_COLORS[0],
  template: "blank",
};

function BoardFields({
  draft,
  onChange,
  idPrefix,
}: {
  draft: BoardDraft;
  onChange: (draft: BoardDraft) => void;
  idPrefix: string;
}) {
  return (
    <FormGrid>
      <FormField label="Name" htmlFor={`${idPrefix}-title`}>
        <Input
          id={`${idPrefix}-title`}
          autoFocus
          value={draft.title}
          onChange={(e) => onChange({ ...draft, title: e.target.value })}
        />
      </FormField>
      <FormField label="Color">
        <div className="flex h-8 items-center">
          <SwatchPicker
            colors={BOARD_COLORS}
            value={draft.color}
            onChange={(color) => onChange({ ...draft, color })}
          />
        </div>
      </FormField>
      <FormField
        label="Description"
        htmlFor={`${idPrefix}-description`}
        className="sm:col-span-2"
      >
        <Textarea
          id={`${idPrefix}-description`}
          value={draft.description}
          onChange={(e) => onChange({ ...draft, description: e.target.value })}
          rows={3}
        />
      </FormField>
    </FormGrid>
  );
}

function BoardsSkeleton() {
  return (
    <div className="flex flex-col">
      {["w-40", "w-56", "w-32", "w-48", "w-36"].map((width) => (
        <div key={width} className="flex h-12 items-center gap-3">
          <Skeleton className="size-2.5 rounded-full" />
          <div className="flex flex-1 flex-col gap-1.5">
            <Skeleton className={cn("h-3.5", width)} />
            <Skeleton className="h-3 w-24" />
          </div>
          <Skeleton className="h-3 w-12" />
        </div>
      ))}
    </div>
  );
}

export default function KanbanPage() {
  const { loading: loadingSettings } = useUserSettings();

  const API = useMemo(
    () => (loadingSettings ? null : new denizApi()),
    [loadingSettings],
  );

  const [boards, setBoards] = useState<IKanbanBoard[]>([]);
  const [initialLoading, setInitialLoading] = useState(true);
  const [selectedBoardId, setSelectedBoardId] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  const [createOpen, setCreateOpen] = useState(false);
  const [createDraft, setCreateDraft] = useState<BoardDraft>(EMPTY_DRAFT);
  const [editingBoard, setEditingBoard] = useState<IKanbanBoard | null>(null);
  const [editDraft, setEditDraft] = useState<BoardDraft>(EMPTY_DRAFT);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<IKanbanBoard | null>(null);

  useEffect(() => {
    const boardId = new URLSearchParams(window.location.search).get("board");
    if (boardId) setSelectedBoardId(boardId);
  }, []);

  const selectBoard = (boardId: string | null) => {
    setSelectedBoardId(boardId);
    window.history.replaceState(
      null,
      "",
      boardId
        ? `/dashboard/kanban?board=${encodeURIComponent(boardId)}`
        : "/dashboard/kanban",
    );
  };

  useEffect(() => {
    if (!API) return;
    API.GET<{ boards: IKanbanBoard[] }>({ endpoint: "kanban/boards" })
      .then((result) => {
        if ("code" in result) toast.error("Failed to load boards");
        else setBoards(result.boards ?? []);
      })
      .finally(() => setInitialLoading(false));
  }, [API]);

  const filteredBoards = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return boards;
    return boards.filter(
      (board) =>
        board.title.toLowerCase().includes(q) ||
        board.description?.toLowerCase().includes(q),
    );
  }, [boards, query]);

  const handleCreate = async () => {
    if (!API || !createDraft.title.trim()) return;
    setIsSubmitting(true);
    try {
      const template = TEMPLATES.find((t) => t.id === createDraft.template);
      const result = await API.POST<{ board: IKanbanBoard }>({
        endpoint: "kanban/boards",
        body: {
          title: createDraft.title.trim(),
          description: createDraft.description.trim() || undefined,
          color: createDraft.color,
        },
      });
      if ("code" in result) {
        toast.error("Failed to create board");
        return;
      }
      const board = result.board;
      setBoards((prev) => [...prev, board]);

      for (const colTitle of template?.columns ?? []) {
        await API.POST({
          endpoint: `kanban/boards/${board._id}/columns`,
          body: {
            title: colTitle,
            isDoneColumn: colTitle.trim().toLowerCase() === "done",
          },
        });
      }

      setCreateOpen(false);
      setCreateDraft(EMPTY_DRAFT);
      selectBoard(board._id);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleUpdate = async () => {
    if (!API || !editingBoard || !editDraft.title.trim()) return;
    setIsSubmitting(true);
    try {
      const patch = {
        title: editDraft.title.trim(),
        description: editDraft.description.trim() || undefined,
        color: editDraft.color,
      };
      const result = await API.PATCH<{ board: IKanbanBoard }>({
        endpoint: `kanban/boards/${editingBoard._id}`,
        body: patch,
      });
      if ("code" in result) {
        toast.error("Failed to update board");
        return;
      }
      setBoards((prev) =>
        prev.map((b) => (b._id === editingBoard._id ? { ...b, ...patch } : b)),
      );
      setEditingBoard(null);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async (board: IKanbanBoard) => {
    if (!API) return;
    const result = await API.DELETE<{ success: true }>({
      endpoint: `kanban/boards/${board._id}`,
    });
    if ("code" in result) {
      toast.error("Failed to delete board");
      return;
    }
    setBoards((prev) => prev.filter((b) => b._id !== board._id));
    if (selectedBoardId === board._id) selectBoard(null);
    setDeleteTarget(null);
  };

  const openEditDialog = (board: IKanbanBoard) => {
    setEditingBoard(board);
    setEditDraft({
      title: board.title,
      description: board.description ?? "",
      color: board.color ?? BOARD_COLORS[0],
      template: "blank",
    });
  };

  const selectedBoard = boards.find((b) => b._id === selectedBoardId);
  const loading = !API || initialLoading;

  // Menu clicks bubble through the portal to the row's own onClick.
  const boardMenu = (board: IKanbanBoard) => (
    <>
      <DropdownMenuItem
        onClick={(event) => {
          event.stopPropagation();
          openEditDialog(board);
        }}
      >
        <Pencil /> Edit
      </DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem
        variant="destructive"
        onClick={(event) => {
          event.stopPropagation();
          setDeleteTarget(board);
        }}
      >
        <Trash2 /> Delete
      </DropdownMenuItem>
    </>
  );

  const dialogs = (
    <>
      <FormDialog
        open={createOpen}
        onOpenChange={(open) => {
          setCreateOpen(open);
          if (!open) setCreateDraft(EMPTY_DRAFT);
        }}
        title="New board"
        submitLabel="Create"
        submitDisabled={!createDraft.title.trim()}
        pending={isSubmitting}
        onSubmit={handleCreate}
      >
        <FormField label="Template">
          <TemplatePicker
            selected={createDraft.template}
            onSelect={(template) =>
              setCreateDraft((prev) => ({
                ...prev,
                template: template.id,
                color: template.id === "blank" ? prev.color : template.color,
              }))
            }
          />
        </FormField>
        <BoardFields
          draft={createDraft}
          onChange={setCreateDraft}
          idPrefix="create-board"
        />
      </FormDialog>

      <FormDialog
        open={editingBoard !== null}
        onOpenChange={(open) => !open && setEditingBoard(null)}
        title="Edit board"
        submitDisabled={!editDraft.title.trim()}
        pending={isSubmitting}
        onSubmit={handleUpdate}
        footerStart={
          editingBoard ? (
            <Button
              type="button"
              variant="ghost"
              className="text-destructive"
              onClick={() => {
                setDeleteTarget(editingBoard);
                setEditingBoard(null);
              }}
            >
              <Trash2 /> Delete
            </Button>
          ) : null
        }
      >
        <BoardFields
          draft={editDraft}
          onChange={setEditDraft}
          idPrefix="edit-board"
        />
      </FormDialog>

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title={`Delete ${deleteTarget?.title ?? "board"}?`}
        description="Every column and card on it is deleted."
        actionLabel="Delete"
        destructive
        onConfirm={() => {
          if (deleteTarget) void handleDelete(deleteTarget);
        }}
      />
    </>
  );

  if (selectedBoardId && API) {
    return (
      <Page>
        <DashboardPageHeader
          crumbs={[{ label: "Kanban", onClick: () => selectBoard(null) }]}
          icon={<BoardDot color={selectedBoard?.color} />}
          title={
            selectedBoard?.title ?? (
              <Skeleton className="h-4 w-32" aria-hidden />
            )
          }
        >
          {selectedBoard && (
            <RowActions label="Board actions">
              {boardMenu(selectedBoard)}
            </RowActions>
          )}
        </DashboardPageHeader>
        <PageBody bleed>
          <KanbanBoard API={API} boardId={selectedBoardId} />
        </PageBody>
        {dialogs}
      </Page>
    );
  }

  return (
    <Page>
      <DashboardPageHeader icon={<LayoutGrid />} title="Kanban">
        <Button size="sm" onClick={() => setCreateOpen(true)}>
          <Plus /> New
        </Button>
      </DashboardPageHeader>
      {boards.length > 0 && (
        <PageToolbar>
          <SearchField value={query} onChange={setQuery} />
        </PageToolbar>
      )}
      <PageBody width="narrow">
        {loading ? (
          <BoardsSkeleton />
        ) : boards.length === 0 ? (
          <EmptyState
            icon={<LayoutGrid />}
            label="No boards"
            action={
              <Button size="sm" onClick={() => setCreateOpen(true)}>
                <Plus /> New board
              </Button>
            }
          />
        ) : filteredBoards.length === 0 ? (
          <EmptyState compact label="0 results" />
        ) : (
          <List>
            {filteredBoards.map((board) => (
              <ListRow
                key={board._id}
                onClick={() => selectBoard(board._id)}
                leading={<BoardDot color={board.color} />}
                title={board.title}
                description={board.description}
                meta={relativeTime(board.updatedAt)}
                trailing={
                  <RowActions className="opacity-0 group-hover/row:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100">
                    {boardMenu(board)}
                  </RowActions>
                }
              />
            ))}
          </List>
        )}
      </PageBody>
      {dialogs}
    </Page>
  );
}
