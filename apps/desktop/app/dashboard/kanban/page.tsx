"use client";

import type { LucideIcon } from "lucide-react";
import {
  ArrowLeft,
  Bug,
  CheckSquare,
  Code2,
  LayoutGrid,
  Megaphone,
  MoreHorizontal,
  Pencil,
  PenLine,
  Plus,
  Square,
  Trash2,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useUserSettings } from "@/context/user-context";
import { denizApi } from "@/lib/api-wrapper";
import type { IKanbanBoard } from "@/lib/data-types";
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
  description: string;
  icon: LucideIcon;
  color: string;
  columns: string[];
}

const TEMPLATES: KanbanTemplate[] = [
  {
    id: "blank",
    name: "Blank Board",
    description: "Start from scratch",
    icon: Square,
    color: "#64748b",
    columns: [],
  },
  {
    id: "software",
    name: "Software Dev",
    description: "Features, bugs & reviews",
    icon: Code2,
    color: "#6366f1",
    columns: ["Backlog", "To Do", "In Progress", "In Review", "Done"],
  },
  {
    id: "personal",
    name: "Personal Tasks",
    description: "Simple personal tracking",
    icon: CheckSquare,
    color: "#a1bc98",
    columns: ["To Do", "In Progress", "Done"],
  },
  {
    id: "content",
    name: "Content Calendar",
    description: "Plan & publish content",
    icon: PenLine,
    color: "#ec4899",
    columns: ["Ideas", "Writing", "In Review", "Published"],
  },
  {
    id: "bugs",
    name: "Bug Tracker",
    description: "Track & resolve issues",
    icon: Bug,
    color: "#ef4444",
    columns: ["Reported", "Triaged", "In Progress", "Fixed", "Closed"],
  },
  {
    id: "marketing",
    name: "Marketing",
    description: "Plan & launch campaigns",
    icon: Megaphone,
    color: "#f97316",
    columns: ["Planning", "Design", "In Review", "Launched"],
  },
];

function ColorPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (c: string) => void;
}) {
  return (
    <div className="flex gap-2 flex-wrap">
      {BOARD_COLORS.map((c) => (
        <button
          key={c}
          type="button"
          onClick={() => onChange(c)}
          className={`size-7 rounded-full border-2 transition-all hover:scale-110 ${
            value === c ? "border-foreground scale-110" : "border-transparent"
          }`}
          style={{ backgroundColor: c }}
        />
      ))}
    </div>
  );
}

function TemplatePicker({
  selected,
  onSelect,
}: {
  selected: string;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="grid grid-cols-3 gap-2">
      {TEMPLATES.map((t) => (
        <button
          key={t.id}
          type="button"
          onClick={() => onSelect(t.id)}
          className={`flex flex-col gap-1.5 p-3 rounded-xl border-2 text-left transition-all hover:border-primary/40 hover:bg-accent/50 ${
            selected === t.id
              ? "border-primary bg-primary/5"
              : "border-border bg-card"
          }`}
        >
          <div
            className="size-8 rounded-lg flex items-center justify-center shrink-0"
            style={{ backgroundColor: `${t.color}20`, color: t.color }}
          >
            <t.icon className="size-4" />
          </div>
          <span className="text-xs font-semibold leading-snug">{t.name}</span>
          <span className="text-[10px] text-muted-foreground leading-snug">
            {t.description}
          </span>
          {t.columns.length > 0 && (
            <div className="flex gap-1 flex-wrap mt-0.5">
              {t.columns.slice(0, 3).map((col) => (
                <span
                  key={col}
                  className="text-[9px] px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground leading-none"
                >
                  {col}
                </span>
              ))}
              {t.columns.length > 3 && (
                <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground leading-none">
                  +{t.columns.length - 3}
                </span>
              )}
            </div>
          )}
        </button>
      ))}
    </div>
  );
}

export default function KanbanPage() {
  const { settings, loading: loadingSettings } = useUserSettings();

  const API = useMemo(() => {
    if (loadingSettings) return null;
    return new denizApi(settings.apiKey);
  }, [settings, loadingSettings]);

  const [boards, setBoards] = useState<IKanbanBoard[]>([]);
  const [initialLoading, setInitialLoading] = useState(true);
  const [selectedBoardId, setSelectedBoardId] = useState<string | null>(null);

  const [createOpen, setCreateOpen] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState("blank");
  const [newTitle, setNewTitle] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [newColor, setNewColor] = useState(BOARD_COLORS[0]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [editingBoard, setEditingBoard] = useState<IKanbanBoard | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editColor, setEditColor] = useState(BOARD_COLORS[0]);

  const [deleteTarget, setDeleteTarget] = useState<IKanbanBoard | null>(null);

  useEffect(() => {
    if (!API || !initialLoading) return;
    API.GET<{ boards: IKanbanBoard[] }>({ endpoint: "kanban/boards" })
      .then((result) => {
        if (!("code" in result)) setBoards(result.boards ?? []);
      })
      .finally(() => setInitialLoading(false));
  }, [API, initialLoading]);

  const handleCreate = async () => {
    if (!API || !newTitle.trim()) return;
    setIsSubmitting(true);
    try {
      const template = TEMPLATES.find((t) => t.id === selectedTemplate);
      const color =
        template?.id !== "blank" ? (template?.color ?? newColor) : newColor;

      const result = await API.POST<{ board: IKanbanBoard }>({
        endpoint: "kanban/boards",
        body: {
          title: newTitle.trim(),
          description: newDescription.trim() || undefined,
          color,
        },
      });
      if ("code" in result) {
        toast.error("Failed to create board");
        return;
      }
      const board = result.board;
      setBoards((prev) => [...prev, board]);

      if (template && template.columns.length > 0) {
        for (const colTitle of template.columns) {
          await API.POST({
            endpoint: `kanban/boards/${board._id}/columns`,
            body: { title: colTitle },
          });
        }
      }

      setCreateOpen(false);
      setNewTitle("");
      setNewDescription("");
      setNewColor(BOARD_COLORS[0]);
      setSelectedTemplate("blank");
      toast.success("Board created");
      setSelectedBoardId(board._id);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleUpdate = async () => {
    if (!API || !editingBoard || !editTitle.trim()) return;
    setIsSubmitting(true);
    try {
      const result = await API.PATCH<{ board: IKanbanBoard }>({
        endpoint: `kanban/boards/${editingBoard._id}`,
        body: {
          title: editTitle.trim(),
          description: editDescription.trim() || undefined,
          color: editColor,
        },
      });
      if ("code" in result) {
        toast.error("Failed to update board");
        return;
      }
      setBoards((prev) =>
        prev.map((b) =>
          b._id === editingBoard._id
            ? {
                ...b,
                title: editTitle.trim(),
                description: editDescription.trim() || undefined,
                color: editColor,
              }
            : b,
        ),
      );
      setEditingBoard(null);
      toast.success("Board updated");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (!API || !deleteTarget) return;
    setIsSubmitting(true);
    try {
      const result = await API.DELETE<{}>({
        endpoint: `kanban/boards/${deleteTarget._id}`,
      });
      if ("code" in result) {
        toast.error("Failed to delete board");
        return;
      }
      setBoards((prev) => prev.filter((b) => b._id !== deleteTarget._id));
      if (selectedBoardId === deleteTarget._id) setSelectedBoardId(null);
      setDeleteTarget(null);
      toast.success("Board deleted");
    } finally {
      setIsSubmitting(false);
    }
  };

  const openEditDialog = (board: IKanbanBoard) => {
    setEditingBoard(board);
    setEditTitle(board.title);
    setEditDescription(board.description ?? "");
    setEditColor(board.color ?? BOARD_COLORS[0]);
  };

  const handleTemplateSelect = (id: string) => {
    setSelectedTemplate(id);
    const t = TEMPLATES.find((t) => t.id === id);
    if (t && t.id !== "blank") setNewColor(t.color);
  };

  const selectedBoard = boards.find((b) => b._id === selectedBoardId);

  if (loadingSettings || !API || initialLoading) {
    return (
      <div className="flex flex-col h-full">
        <div className="flex items-center gap-2 px-4 border-b h-12 shrink-0">
          <div className="h-4 w-32 bg-muted rounded animate-pulse flex-1" />
          <div className="h-7 w-24 bg-muted rounded animate-pulse" />
        </div>
        <div className="flex-1 overflow-auto p-6">
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <div
                key={i}
                className="rounded-2xl border bg-card overflow-hidden animate-pulse"
              >
                <div className="h-20 bg-muted" />
                <div className="p-4 flex flex-col gap-2">
                  <div className="h-4 w-3/4 bg-muted rounded" />
                  <div className="h-3 w-full bg-muted rounded" />
                  <div className="h-3 w-2/3 bg-muted rounded" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full w-full max-w-screen">
      <div className="flex items-center gap-2 px-4 border-b h-12 shrink-0">
        {selectedBoard ? (
          <>
            <Button
              variant="ghost"
              size="icon"
              className="size-7"
              onClick={() => setSelectedBoardId(null)}
            >
              <ArrowLeft className="size-4" />
            </Button>
            {selectedBoard.color && (
              <div
                className="size-3 rounded-full shrink-0"
                style={{ backgroundColor: selectedBoard.color }}
              />
            )}
            <span className="text-sm font-semibold flex-1 truncate">
              {selectedBoard.title}
            </span>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="size-7">
                  <MoreHorizontal className="size-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => openEditDialog(selectedBoard)}>
                  <Pencil className="size-3.5 mr-2" /> Edit board
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="text-destructive"
                  onClick={() => setDeleteTarget(selectedBoard)}
                >
                  <Trash2 className="size-3.5 mr-2" /> Delete board
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        ) : (
          <>
            <LayoutGrid className="size-4 text-muted-foreground" />
            <span className="text-sm font-semibold flex-1">Kanban Boards</span>
            <Button size="sm" onClick={() => setCreateOpen(true)}>
              <Plus /> New Board
            </Button>
          </>
        )}
      </div>

      {selectedBoardId ? (
        <div className="flex-1 min-h-0 overflow-x-auto min-w-0 max-w-screen">
          <KanbanBoard API={API} boardId={selectedBoardId} />
        </div>
      ) : (
        <div className="flex-1 overflow-auto p-6">
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {boards.map((board) => (
              <div
                key={board._id}
                role="button"
                tabIndex={0}
                onClick={() => setSelectedBoardId(board._id)}
                onKeyDown={(e) =>
                  e.key === "Enter" && setSelectedBoardId(board._id)
                }
                className="group rounded-2xl border bg-card overflow-hidden cursor-pointer hover:shadow-md transition-all duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <div
                  className="h-16 relative"
                  style={{
                    backgroundColor: board.color ?? "#6366f1",
                    backgroundImage: board.color
                      ? `linear-gradient(135deg, ${board.color}dd, ${board.color}88)`
                      : undefined,
                  }}
                >
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button
                        className="absolute top-2 right-2 size-6 rounded-full bg-black/20 hover:bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <MoreHorizontal className="size-3.5 text-white" />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem
                        onClick={(e) => {
                          e.stopPropagation();
                          openEditDialog(board);
                        }}
                      >
                        <Pencil className="size-3.5 mr-2" /> Edit
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        className="text-destructive"
                        onClick={(e) => {
                          e.stopPropagation();
                          setDeleteTarget(board);
                        }}
                      >
                        <Trash2 className="size-3.5 mr-2" /> Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>

                <div className="p-4">
                  <p className="text-sm font-semibold leading-snug line-clamp-1">
                    {board.title}
                  </p>
                  {board.description && (
                    <p className="text-xs text-muted-foreground mt-1 line-clamp-2 leading-relaxed">
                      {board.description}
                    </p>
                  )}
                </div>
              </div>
            ))}

            <button
              onClick={() => setCreateOpen(true)}
              className="rounded-2xl border-2 border-dashed bg-transparent hover:bg-muted/50 transition-colors h-full min-h-29 flex flex-col items-center justify-center gap-2 text-muted-foreground hover:text-foreground"
            >
              <div className="size-8 rounded-full border-2 border-dashed flex items-center justify-center">
                <Plus className="size-4" />
              </div>
              <span className="text-xs font-medium">New Board</span>
            </button>
          </div>
        </div>
      )}

      <Dialog
        open={createOpen}
        onOpenChange={(open) => {
          setCreateOpen(open);
          if (!open) {
            setSelectedTemplate("blank");
            setNewTitle("");
            setNewDescription("");
            setNewColor(BOARD_COLORS[0]);
          }
        }}
      >
        <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>New Board</DialogTitle>
            <DialogDescription>
              Choose a template or start blank.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-5">
            <div className="flex flex-col gap-2">
              <Label className="text-xs text-muted-foreground uppercase tracking-wide">
                Template
              </Label>
              <TemplatePicker
                selected={selectedTemplate}
                onSelect={handleTemplateSelect}
              />
            </div>

            <div className="flex flex-col gap-4 pt-1 border-t">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="create-title">Board name</Label>
                <Input
                  id="create-title"
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  placeholder={
                    TEMPLATES.find((t) => t.id === selectedTemplate)?.name ??
                    "e.g. Project Alpha"
                  }
                  onKeyDown={(e) => e.key === "Enter" && handleCreate()}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="create-desc">
                  Description{" "}
                  <span className="text-muted-foreground font-normal">
                    (optional)
                  </span>
                </Label>
                <Textarea
                  id="create-desc"
                  value={newDescription}
                  onChange={(e) => setNewDescription(e.target.value)}
                  placeholder="What is this board for?"
                  rows={2}
                  className="resize-none"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>Color</Label>
                <ColorPicker value={newColor} onChange={setNewColor} />
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setCreateOpen(false)}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button
              onClick={handleCreate}
              disabled={isSubmitting || !newTitle.trim()}
            >
              {isSubmitting ? "Creating…" : "Create Board"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!editingBoard}
        onOpenChange={(open) => !open && setEditingBoard(null)}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Edit Board</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="edit-title">Title</Label>
              <Input
                id="edit-title"
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleUpdate()}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="edit-desc">Description</Label>
              <Textarea
                id="edit-desc"
                value={editDescription}
                onChange={(e) => setEditDescription(e.target.value)}
                rows={2}
                className="resize-none"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Color</Label>
              <ColorPicker value={editColor} onChange={setEditColor} />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setEditingBoard(null)}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button
              onClick={handleUpdate}
              disabled={isSubmitting || !editTitle.trim()}
            >
              {isSubmitting ? "Saving…" : "Save Changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Board</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete &quot;{deleteTarget?.title}&quot;?
              All columns and cards will be permanently deleted. This action
              cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDeleteTarget(null)}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={isSubmitting}
            >
              {isSubmitting ? "Deleting…" : "Delete Board"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
