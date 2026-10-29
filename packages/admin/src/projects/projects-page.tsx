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
import type { IProject } from "@repo/schemas";
import { Badge } from "@repo/ui/badge";
import { Button } from "@repo/ui/button";
import { ConfirmDialog } from "@repo/ui/confirm-button";
import {
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@repo/ui/dropdown-menu";
import { EmptyState } from "@repo/ui/empty-state";
import { List, ListRow } from "@repo/ui/list";
import { Page, PageBody, PageHeader, PageToolbar } from "@repo/ui/page";
import { Skeleton } from "@repo/ui/skeleton";
import { Spinner } from "@repo/ui/spinner";
import {
  FilterTabs,
  RowActions,
  SearchField,
  ToolbarSpacer,
} from "@repo/ui/toolbar";
import { cn } from "@repo/ui/utils";
import {
  Eye,
  EyeOff,
  FolderGit2,
  GripVertical,
  Pencil,
  Plus,
  RefreshCw,
  Star,
  StarOff,
  Trash2,
  Undo2,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  type HTMLAttributes,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { toast } from "sonner";
import { useAdmin } from "../provider";

type VisibilityFilter = "all" | "published" | "hidden" | "featured";

const ICON = <FolderGit2 />;

function ProjectsHeader({ children }: { children?: ReactNode }) {
  const { slots } = useAdmin();
  return (
    <PageHeader leading={slots?.sidebarTrigger} icon={ICON} title="Projects">
      {children}
    </PageHeader>
  );
}

export function ProjectsSkeleton() {
  return (
    <Page>
      <ProjectsHeader />
      <PageToolbar>
        <Skeleton className="h-7 w-56" />
        <Skeleton className="h-5 w-64" />
      </PageToolbar>
      <PageBody>
        <div className="flex flex-col gap-1">
          {Array.from({ length: 8 }).map((_, index) => (
            <div key={index} className="flex h-12 items-center gap-3">
              <Skeleton className="size-5 rounded" />
              <div className="flex flex-1 flex-col gap-1.5">
                <Skeleton className="h-3.5 w-48" />
                <Skeleton className="h-3 w-72" />
              </div>
              <Skeleton className="h-5 w-16" />
            </div>
          ))}
        </div>
      </PageBody>
    </Page>
  );
}

function matchesQuery(project: IProject, query: string): boolean {
  if (!query) return true;
  const needle = query.toLowerCase();
  return (
    project.title.toLowerCase().includes(needle) ||
    project.subtitle.toLowerCase().includes(needle) ||
    project.tags.some((tag) => tag.toLowerCase().includes(needle))
  );
}

export function ProjectsPage() {
  const { client, routes } = useAdmin();
  const router = useRouter();

  const [projects, setProjects] = useState<IProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState<VisibilityFilter>("all");
  const [query, setQuery] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<IProject | null>(null);
  const [originalOrder, setOriginalOrder] = useState<IProject[]>([]);
  const [savingOrder, setSavingOrder] = useState(false);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const fetchProjects = useCallback(async () => {
    try {
      const result = await client.get<{ projects: IProject[] }>("projects");
      const sorted = [...result.projects].sort((a, b) => a.order - b.order);
      setProjects(sorted);
      setOriginalOrder(sorted);
    } catch {
      toast.error("Failed to load projects");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [client]);

  useEffect(() => {
    void fetchProjects();
  }, [fetchProjects]);

  const counts = useMemo(() => {
    const published = projects.filter((p) => p.isActive).length;
    return {
      all: projects.length,
      published,
      hidden: projects.length - published,
      featured: projects.filter((p) => p.isFeatured).length,
    };
  }, [projects]);

  const trimmedQuery = query.trim();
  const visibleProjects = useMemo(
    () =>
      projects.filter((project) => {
        if (filter === "published" && !project.isActive) return false;
        if (filter === "hidden" && project.isActive) return false;
        if (filter === "featured" && !project.isFeatured) return false;
        return matchesQuery(project, trimmedQuery);
      }),
    [projects, filter, trimmedQuery],
  );

  // Order only means something over the whole list.
  const sortable = filter === "all" && !trimmedQuery;

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
    setSavingOrder(true);
    const ordered = projects.map((p, i) => ({ _id: p._id, order: i }));
    try {
      await client.patch<{ success: boolean }>("projects/reorder", {
        items: ordered,
      });
      const updated = projects.map((p, i) => ({ ...p, order: i }));
      setProjects(updated);
      setOriginalOrder(updated);
      toast.success("Order saved");
    } catch {
      toast.error("Failed to save order");
    }
    setSavingOrder(false);
  };

  const patchLocal = (id: string, patch: Partial<IProject>) => {
    const apply = (list: IProject[]) =>
      list.map((p) => (p._id === id ? { ...p, ...patch } : p));
    setProjects(apply);
    setOriginalOrder(apply);
  };

  const handleToggle = async (
    project: IProject,
    field: "isActive" | "isFeatured",
  ) => {
    patchLocal(project._id, { [field]: !project[field] });
    try {
      await client.patch<{ project: IProject }>(`projects/${project._id}`, {
        [field === "isActive" ? "toggleActive" : "toggleFeatured"]: true,
      });
    } catch {
      toast.error("Failed to update");
      patchLocal(project._id, { [field]: project[field] });
    }
  };

  const handleDelete = async () => {
    const target = deleteTarget;
    if (!target) return;
    setDeleteTarget(null);
    try {
      await client.del<{ message: string }>(`projects/${target._id}`);
      setProjects((prev) => prev.filter((p) => p._id !== target._id));
      setOriginalOrder((prev) => prev.filter((p) => p._id !== target._id));
      toast.success("Project deleted");
    } catch {
      toast.error("Failed to delete project");
    }
  };

  if (loading) return <ProjectsSkeleton />;

  const rowProps = (project: IProject) => ({
    project,
    onEdit: () => router.push(routes.projects.edit(project._id)),
    onToggleActive: () => void handleToggle(project, "isActive"),
    onToggleFeatured: () => void handleToggle(project, "isFeatured"),
    onDelete: () => setDeleteTarget(project),
  });

  return (
    <Page>
      <ProjectsHeader>
        {hasOrderChanges ? (
          <>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setProjects(originalOrder)}
              disabled={savingOrder}
            >
              <Undo2 />
              Reset
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleSaveOrder}
              disabled={savingOrder}
            >
              {savingOrder ? <Spinner className="size-3.5" /> : null}
              Save order
            </Button>
          </>
        ) : null}
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Refresh"
          disabled={refreshing}
          onClick={() => {
            setRefreshing(true);
            void fetchProjects();
          }}
        >
          <RefreshCw className={cn(refreshing && "animate-spin")} />
        </Button>
        <Button size="sm" asChild>
          <Link href={routes.projects.new}>
            <Plus />
            New project
          </Link>
        </Button>
      </ProjectsHeader>

      <PageToolbar>
        <SearchField
          value={query}
          onChange={setQuery}
          placeholder="Search title, tag"
          className="w-64"
        />
        <FilterTabs<VisibilityFilter>
          value={filter}
          onChange={setFilter}
          options={[
            { value: "all", label: "All", count: counts.all },
            { value: "published", label: "Published", count: counts.published },
            { value: "hidden", label: "Hidden", count: counts.hidden },
            { value: "featured", label: "Featured", count: counts.featured },
          ]}
        />
        <ToolbarSpacer />
      </PageToolbar>

      <PageBody>
        {projects.length === 0 ? (
          <EmptyState
            icon={ICON}
            label="No projects"
            action={
              <Button size="sm" variant="outline" asChild>
                <Link href={routes.projects.new}>
                  <Plus />
                  New project
                </Link>
              </Button>
            }
          />
        ) : visibleProjects.length === 0 ? (
          <EmptyState icon={ICON} label="No matching projects" />
        ) : sortable ? (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            modifiers={[restrictToVerticalAxis]}
            onDragEnd={handleDragEnd}
          >
            <SortableContext
              items={visibleProjects.map((p) => p._id)}
              strategy={verticalListSortingStrategy}
            >
              <List>
                {visibleProjects.map((project) => (
                  <SortableProjectRow
                    key={project._id}
                    {...rowProps(project)}
                  />
                ))}
              </List>
            </SortableContext>
          </DndContext>
        ) : (
          <List>
            {visibleProjects.map((project) => (
              <ProjectRow key={project._id} {...rowProps(project)} />
            ))}
          </List>
        )}
      </PageBody>

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
        title="Delete project?"
        description={
          deleteTarget
            ? `“${deleteTarget.title}” will be permanently deleted.`
            : undefined
        }
        actionLabel="Delete"
        destructive
        onConfirm={handleDelete}
      />
    </Page>
  );
}

interface ProjectRowProps {
  project: IProject;
  onEdit: () => void;
  onToggleActive: () => void;
  onToggleFeatured: () => void;
  onDelete: () => void;
}

function SortableProjectRow(props: ProjectRowProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: props.project._id });

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
      }}
      className={cn("relative", isDragging && "z-10 opacity-60")}
    >
      <ProjectRow
        {...props}
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
}: ProjectRowProps & {
  dragHandleProps?: HTMLAttributes<HTMLButtonElement>;
}) {
  const visibleTags = project.tags.slice(0, 2);
  return (
    <ListRow
      onClick={onEdit}
      className={cn("min-h-12", !project.isActive && "opacity-60")}
      leading={
        project.images[0] ? (
          <img
            src={project.images[0]}
            alt=""
            className="size-5 rounded object-cover"
          />
        ) : (
          <FolderGit2 />
        )
      }
      title={
        <span className="flex items-center gap-1.5">
          <span className="truncate">{project.title}</span>
          {project.isFeatured ? (
            <Star
              aria-label="Featured"
              className="size-3 shrink-0 fill-current text-status-warning"
            />
          ) : null}
        </span>
      }
      description={project.subtitle}
      meta={
        <>
          <span className="hidden items-center gap-1 md:flex">
            {visibleTags.map((tag) => (
              <Badge key={tag} variant="secondary">
                {tag}
              </Badge>
            ))}
            {project.tags.length > visibleTags.length ? (
              <span>+{project.tags.length - visibleTags.length}</span>
            ) : null}
          </span>
          {project.isActive ? null : <Badge variant="outline">Hidden</Badge>}
        </>
      }
      trailing={
        <>
          {dragHandleProps ? (
            <button
              type="button"
              aria-label={`Reorder ${project.title}`}
              className="flex size-7 cursor-grab touch-none items-center justify-center rounded-md text-muted-foreground opacity-0 transition-opacity group-hover/row:opacity-100 focus-visible:opacity-100 active:cursor-grabbing"
              {...dragHandleProps}
            >
              <GripVertical className="size-3.5" />
            </button>
          ) : null}
          <RowActions>
            <DropdownMenuItem onClick={onEdit}>
              <Pencil />
              Edit
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onToggleFeatured}>
              {project.isFeatured ? <StarOff /> : <Star />}
              {project.isFeatured ? "Unfeature" : "Feature"}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onToggleActive}>
              {project.isActive ? <EyeOff /> : <Eye />}
              {project.isActive ? "Hide" : "Publish"}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onClick={onDelete}>
              <Trash2 />
              Delete
            </DropdownMenuItem>
          </RowActions>
        </>
      }
    />
  );
}
