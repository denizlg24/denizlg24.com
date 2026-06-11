"use client";

import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { restrictToVerticalAxis } from "@dnd-kit/modifiers";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  Eye,
  EyeOff,
  FolderGit2,
  GripVertical,
  Loader2,
  MoreHorizontal,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  Star,
  StarOff,
  Trash2,
  Undo2,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useUserSettings } from "@/context/user-context";
import { denizApi } from "@/lib/api-wrapper";
import type { IProject } from "@/lib/data-types";
import { ProjectEditorSheet } from "./_components/project-editor-sheet";

type VisibilityFilter = "all" | "published" | "hidden";

function ProjectsLoadingSkeleton() {
  return (
    <div className="flex flex-col gap-2 pb-8">
      <div className="flex items-center gap-2 px-4 border-b h-12 shrink-0">
        <FolderGit2 className="size-4 text-muted-foreground" />
        <span className="text-sm font-semibold flex-1">Projects</span>
      </div>
      <div className="px-4 flex flex-col gap-6 pt-3">
        <div className="flex items-baseline gap-8">
          {[1, 2, 3].map((i) => (
            <div key={i} className="flex flex-col gap-1">
              <Skeleton className="h-3 w-14" />
              <Skeleton className="h-6 w-8" />
            </div>
          ))}
        </div>
        <Skeleton className="h-9 w-64 rounded-lg" />
        <div className="flex flex-col gap-1">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="flex items-center gap-3 py-3 border-b">
              <Skeleton className="h-4 w-4" />
              <Skeleton className="h-10 w-14 rounded" />
              <div className="flex-1 flex flex-col gap-1">
                <Skeleton className="h-4 w-40" />
                <Skeleton className="h-3 w-56" />
              </div>
              <Skeleton className="h-5 w-16 rounded-full" />
              <Skeleton className="h-6 w-6 rounded" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function ProjectsPage() {
  const { settings, loading: loadingSettings } = useUserSettings();

  const api = useMemo(() => {
    if (loadingSettings) return null;
    return new denizApi(settings.apiKey);
  }, [settings, loadingSettings]);

  const [projects, setProjects] = useState<IProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<VisibilityFilter>("all");
  const [editProject, setEditProject] = useState<IProject | null>(null);
  const [editSheetOpen, setEditSheetOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<IProject | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [originalOrder, setOriginalOrder] = useState<IProject[]>([]);
  const [savingOrder, setSavingOrder] = useState(false);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const fetchProjects = useCallback(async () => {
    if (!api) return;
    const result = await api.GET<{ projects: IProject[] }>({
      endpoint: "projects",
    });
    if (!("code" in result)) {
      const sorted = result.projects.sort((a, b) => a.order - b.order);
      setProjects(sorted);
      setOriginalOrder(sorted);
    } else {
      toast.error("Failed to load projects");
    }
    setLoading(false);
  }, [api]);

  useEffect(() => {
    fetchProjects();
  }, [fetchProjects]);

  const stats = useMemo(() => {
    const active = projects.filter((p) => p.isActive).length;
    const featured = projects.filter((p) => p.isFeatured).length;
    return {
      total: projects.length,
      active,
      hidden: projects.length - active,
      featured,
    };
  }, [projects]);

  const filteredProjects = useMemo(() => {
    if (filter === "all") return projects;
    if (filter === "published") return projects.filter((p) => p.isActive);
    return projects.filter((p) => !p.isActive);
  }, [projects, filter]);

  const hasOrderChanges = useMemo(() => {
    if (projects.length !== originalOrder.length) return false;
    return projects.some((p, i) => p._id !== originalOrder[i]?._id);
  }, [projects, originalOrder]);

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    setProjects((prev) => {
      const oldIndex = prev.findIndex((p) => p._id === active.id);
      const newIndex = prev.findIndex((p) => p._id === over.id);
      return arrayMove(prev, oldIndex, newIndex);
    });
  };

  const handleSaveOrder = async () => {
    if (!api) return;
    setSavingOrder(true);

    const ordered = projects.map((p, i) => ({ id: p._id, order: i }));
    const result = await api.PATCH<{ success: boolean }>({
      endpoint: "projects/reorder",
      body: { items: ordered },
    });

    if ("code" in result) {
      toast.error("Failed to save order");
    } else {
      const updated = projects.map((p, i) => ({ ...p, order: i }));
      setProjects(updated);
      setOriginalOrder(updated);
      toast.success("Order saved");
    }
    setSavingOrder(false);
  };

  const handleResetOrder = () => {
    setProjects(originalOrder);
  };

  const handleToggleActive = async (project: IProject) => {
    if (!api) return;
    setProjects((prev) =>
      prev.map((p) =>
        p._id === project._id ? { ...p, isActive: !p.isActive } : p,
      ),
    );

    const result = await api.PATCH<{ project: IProject }>({
      endpoint: `projects/${project._id}`,
      body: { toggleActive: true },
    });

    if ("code" in result) {
      toast.error("Failed to update");
      setProjects((prev) =>
        prev.map((p) =>
          p._id === project._id ? { ...p, isActive: project.isActive } : p,
        ),
      );
    }
  };

  const handleToggleFeatured = async (project: IProject) => {
    if (!api) return;
    setProjects((prev) =>
      prev.map((p) =>
        p._id === project._id ? { ...p, isFeatured: !p.isFeatured } : p,
      ),
    );

    const result = await api.PATCH<{ project: IProject }>({
      endpoint: `projects/${project._id}`,
      body: { toggleFeatured: true },
    });

    if ("code" in result) {
      toast.error("Failed to update");
      setProjects((prev) =>
        prev.map((p) =>
          p._id === project._id ? { ...p, isFeatured: project.isFeatured } : p,
        ),
      );
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget || !api) return;
    setDeleting(true);

    const result = await api.DELETE<{ message: string }>({
      endpoint: `projects/${deleteTarget._id}`,
    });

    if ("code" in result) {
      toast.error("Failed to delete project");
    } else {
      setProjects((prev) => prev.filter((p) => p._id !== deleteTarget._id));
      setOriginalOrder((prev) =>
        prev.filter((p) => p._id !== deleteTarget._id),
      );
      toast.success("Project deleted");
    }
    setDeleting(false);
    setDeleteTarget(null);
  };

  const handleSaved = (updated: IProject) => {
    setProjects((prev) =>
      prev.map((p) => (p._id === updated._id ? updated : p)),
    );
    setOriginalOrder((prev) =>
      prev.map((p) => (p._id === updated._id ? updated : p)),
    );
  };

  if (loadingSettings || loading) {
    return <ProjectsLoadingSkeleton />;
  }

  if (!api) {
    return (
      <div className="flex flex-col gap-2 pb-8">
        <div className="flex items-center gap-2 px-4 border-b h-12 shrink-0">
          <FolderGit2 className="size-4 text-muted-foreground" />
          <span className="text-sm font-semibold flex-1">Projects</span>
        </div>
        <div className="px-4 pt-12 text-center text-muted-foreground text-sm">
          Failed to initialize API client.
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 pb-8 h-full">
      <div className="flex items-center gap-2 px-4 border-b h-12 shrink-0">
        <FolderGit2 className="size-4 text-muted-foreground" />
        <span className="text-sm font-semibold flex-1">Projects</span>

        {hasOrderChanges && (
          <>
            <Button
              variant="ghost"
              size="sm"
              className="h-8 text-xs gap-1.5"
              onClick={handleResetOrder}
              disabled={savingOrder}
            >
              <Undo2 className="size-3.5" />
              Reset
            </Button>
            <Button
              size="sm"
              className="h-8 text-xs gap-1.5"
              onClick={handleSaveOrder}
              disabled={savingOrder}
            >
              {savingOrder ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Save className="size-3.5" />
              )}
              Save Order
            </Button>
          </>
        )}

        <Button
          variant="ghost"
          size="sm"
          className="h-8 text-xs gap-1.5"
          onClick={() => {
            setLoading(true);
            fetchProjects();
          }}
        >
          <RefreshCw className={`size-3.5 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </Button>
        <Button size="sm" className="h-8 text-xs gap-1.5" asChild>
          <Link href="/dashboard/projects/new">
            <Plus className="size-3.5" />
            New Project
          </Link>
        </Button>
      </div>

      <div className="px-4 flex flex-col gap-4 pt-3 flex-1 min-h-0 overflow-y-auto">
        <div className="flex items-baseline gap-8 flex-wrap">
          <Stat label="Total" value={stats.total} />
          <Stat label="Active" value={stats.active} />
          <Stat
            label="Hidden"
            value={stats.hidden}
            highlight={stats.hidden > 0}
          />
          <Stat label="Featured" value={stats.featured} />
        </div>

        <Separator />

        <Tabs
          value={filter}
          onValueChange={(v) => setFilter(v as VisibilityFilter)}
        >
          <TabsList variant="line">
            <TabsTrigger value="all">
              All
              <span className="ml-1 text-[10px] text-muted-foreground tabular-nums">
                {stats.total}
              </span>
            </TabsTrigger>
            <TabsTrigger value="published">
              Published
              <span className="ml-1 text-[10px] text-muted-foreground tabular-nums">
                {stats.active}
              </span>
            </TabsTrigger>
            <TabsTrigger value="hidden">
              Hidden
              <span className="ml-1 text-[10px] text-muted-foreground tabular-nums">
                {stats.hidden}
              </span>
            </TabsTrigger>
          </TabsList>
        </Tabs>

        {filteredProjects.length === 0 ? (
          <div className="py-12 text-center text-muted-foreground text-sm">
            No projects found
          </div>
        ) : filter === "all" ? (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            modifiers={[restrictToVerticalAxis]}
            onDragEnd={handleDragEnd}
          >
            <SortableContext
              items={filteredProjects.map((p) => p._id)}
              strategy={verticalListSortingStrategy}
            >
              <div className="flex flex-col">
                {filteredProjects.map((project) => (
                  <SortableProjectRow
                    key={project._id}
                    project={project}
                    onEdit={() => {
                      setEditProject(project);
                      setEditSheetOpen(true);
                    }}
                    onToggleActive={() => handleToggleActive(project)}
                    onToggleFeatured={() => handleToggleFeatured(project)}
                    onDelete={() => setDeleteTarget(project)}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        ) : (
          <div className="flex flex-col">
            {filteredProjects.map((project) => (
              <ProjectRow
                key={project._id}
                project={project}
                onEdit={() => {
                  setEditProject(project);
                  setEditSheetOpen(true);
                }}
                onToggleActive={() => handleToggleActive(project)}
                onToggleFeatured={() => handleToggleFeatured(project)}
                onDelete={() => setDeleteTarget(project)}
              />
            ))}
          </div>
        )}
      </div>

      <ProjectEditorSheet
        project={editProject}
        open={editSheetOpen}
        onOpenChange={setEditSheetOpen}
        api={api}
        onSaved={handleSaved}
      />

      <AlertDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
      >
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete project?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete &ldquo;{deleteTarget?.title}&rdquo;.
              This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={handleDelete}
              disabled={deleting}
            >
              {deleting ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function SortableProjectRow({
  project,
  onEdit,
  onToggleActive,
  onToggleFeatured,
  onDelete,
}: {
  project: IProject;
  onEdit: () => void;
  onToggleActive: () => void;
  onToggleFeatured: () => void;
  onDelete: () => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: project._id,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : undefined,
  };

  return (
    <div ref={setNodeRef} style={style}>
      <ProjectRow
        project={project}
        onEdit={onEdit}
        onToggleActive={onToggleActive}
        onToggleFeatured={onToggleFeatured}
        onDelete={onDelete}
        dragHandleProps={{ ...attributes, ...listeners }}
      />
    </div>
  );
}

function ProjectRow({
  project,
  onEdit,
  onToggleActive,
  onToggleFeatured,
  onDelete,
  dragHandleProps,
}: {
  project: IProject;
  onEdit: () => void;
  onToggleActive: () => void;
  onToggleFeatured: () => void;
  onDelete: () => void;
  dragHandleProps?: Record<string, unknown>;
}) {
  return (
    <div
      className={`flex items-center gap-3 py-2.5 px-1 border-b transition-opacity cursor-pointer hover:bg-muted/50 ${
        !project.isActive ? "opacity-50" : ""
      }`}
      onClick={onEdit}
    >
      {dragHandleProps && (
        <button
          className="cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground touch-none"
          onClick={(e) => e.stopPropagation()}
          {...dragHandleProps}
        >
          <GripVertical className="size-4" />
        </button>
      )}

      {project.images[0] ? (
        <img
          src={project.images[0]}
          alt=""
          className="size-10 rounded object-cover shrink-0 border"
        />
      ) : (
        <div className="size-10 rounded bg-muted shrink-0 border flex items-center justify-center">
          <FolderGit2 className="size-4 text-muted-foreground" />
        </div>
      )}

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="text-sm font-medium truncate">{project.title}</span>
          {project.isFeatured && (
            <Star className="size-3 text-yellow-500 fill-yellow-500 shrink-0" />
          )}
        </div>
        <span className="text-xs text-muted-foreground truncate block">
          {project.subtitle}
        </span>
      </div>

      <div className="flex gap-1 flex-wrap max-w-[120px] shrink-0">
        {project.tags.slice(0, 2).map((tag) => (
          <Badge
            key={tag}
            variant="secondary"
            className="text-[10px] px-1.5 py-0"
          >
            {tag}
          </Badge>
        ))}
        {project.tags.length > 2 && (
          <span className="text-[10px] text-muted-foreground">
            +{project.tags.length - 2}
          </span>
        )}
      </div>

      {project.isActive ? (
        <Badge variant="default" className="text-[10px] shrink-0">
          Active
        </Badge>
      ) : (
        <Badge variant="outline" className="text-[10px] shrink-0">
          Hidden
        </Badge>
      )}

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0 shrink-0"
            onClick={(e) => e.stopPropagation()}
          >
            <MoreHorizontal className="size-3.5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem
            onClick={(e) => {
              e.stopPropagation();
              onEdit();
            }}
          >
            <Pencil className="size-3.5" />
            Edit
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={(e) => {
              e.stopPropagation();
              onToggleFeatured();
            }}
          >
            {project.isFeatured ? (
              <>
                <StarOff className="size-3.5" />
                Unfeature
              </>
            ) : (
              <>
                <Star className="size-3.5" />
                Feature
              </>
            )}
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={(e) => {
              e.stopPropagation();
              onToggleActive();
            }}
          >
            {project.isActive ? (
              <>
                <EyeOff className="size-3.5" />
                Hide
              </>
            ) : (
              <>
                <Eye className="size-3.5" />
                Publish
              </>
            )}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            className="text-destructive focus:text-destructive"
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
          >
            <Trash2 className="size-3.5" />
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

function Stat({
  label,
  value,
  highlight,
}: {
  label: string;
  value: number;
  highlight?: boolean;
}) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p
        className={`text-lg font-semibold tabular-nums tracking-tight ${highlight ? "text-primary" : ""}`}
      >
        {value}
      </p>
    </div>
  );
}
