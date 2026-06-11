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
  Briefcase,
  Eye,
  EyeOff,
  GripVertical,
  Loader2,
  MoreHorizontal,
  Pencil,
  Plus,
  RefreshCw,
  Save,
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
import type { ITimelineItem } from "@/lib/data-types";
import { TimelineEditorSheet } from "./_components/timeline-editor-sheet";

type CategoryFilter = "all" | "work" | "education" | "personal";

const CATEGORY_LABELS: Record<ITimelineItem["category"], string> = {
  work: "Work",
  education: "Education",
  personal: "Personal",
};

const CATEGORY_VARIANTS: Record<
  ITimelineItem["category"],
  "default" | "secondary" | "outline"
> = {
  work: "default",
  education: "secondary",
  personal: "outline",
};

function formatDateRange(from: string, to?: string): string {
  const fmt = (d: string) =>
    new Date(d).toLocaleDateString("en-US", {
      month: "short",
      year: "numeric",
    });
  return to ? `${fmt(from)} — ${fmt(to)}` : `${fmt(from)} — Present`;
}

function TimelineLoadingSkeleton() {
  return (
    <div className="flex flex-col gap-2 pb-8">
      <div className="flex items-center gap-2 px-4 border-b h-12 shrink-0">
        <Briefcase className="size-4 text-muted-foreground" />
        <span className="text-sm font-semibold flex-1">Timeline</span>
      </div>
      <div className="px-4 flex flex-col gap-6 pt-3">
        <div className="flex items-baseline gap-8">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="flex flex-col gap-1">
              <Skeleton className="h-3 w-14" />
              <Skeleton className="h-6 w-8" />
            </div>
          ))}
        </div>
        <Skeleton className="h-9 w-80 rounded-lg" />
        <div className="flex flex-col gap-1">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="flex items-center gap-3 py-3 border-b">
              <Skeleton className="h-4 w-4" />
              <Skeleton className="size-10 rounded" />
              <div className="flex-1 flex flex-col gap-1">
                <Skeleton className="h-4 w-36" />
                <Skeleton className="h-3 w-48" />
              </div>
              <Skeleton className="h-5 w-20 rounded-full" />
              <Skeleton className="h-6 w-6 rounded" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function TimelinePage() {
  const { settings, loading: loadingSettings } = useUserSettings();

  const api = useMemo(() => {
    if (loadingSettings) return null;
    return new denizApi(settings.apiKey);
  }, [settings, loadingSettings]);

  const [items, setItems] = useState<ITimelineItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>("all");
  const [editItem, setEditItem] = useState<ITimelineItem | null>(null);
  const [editSheetOpen, setEditSheetOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<ITimelineItem | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [originalOrder, setOriginalOrder] = useState<ITimelineItem[]>([]);
  const [savingOrder, setSavingOrder] = useState(false);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const fetchItems = useCallback(async () => {
    if (!api) return;
    const result = await api.GET<{ items: ITimelineItem[] }>({
      endpoint: "timeline",
    });
    if (!("code" in result)) {
      const sorted = result.items.sort((a, b) => a.order - b.order);
      setItems(sorted);
      setOriginalOrder(sorted);
    } else {
      toast.error("Failed to load timeline");
    }
    setLoading(false);
  }, [api]);

  useEffect(() => {
    fetchItems();
  }, [fetchItems]);

  const stats = useMemo(() => {
    const work = items.filter((i) => i.category === "work").length;
    const education = items.filter((i) => i.category === "education").length;
    const personal = items.filter((i) => i.category === "personal").length;
    return { total: items.length, work, education, personal };
  }, [items]);

  const filteredItems = useMemo(() => {
    if (categoryFilter === "all") return items;
    return items.filter((i) => i.category === categoryFilter);
  }, [items, categoryFilter]);

  const hasOrderChanges = useMemo(() => {
    if (items.length !== originalOrder.length) return false;
    return items.some((item, i) => item._id !== originalOrder[i]?._id);
  }, [items, originalOrder]);

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const activeItem = items.find((i) => i._id === active.id);
    const overItem = items.find((i) => i._id === over.id);
    if (!activeItem || !overItem) return;

    if (categoryFilter !== "all" && activeItem.category !== overItem.category)
      return;

    setItems((prev) => {
      const oldIndex = prev.findIndex((i) => i._id === active.id);
      const newIndex = prev.findIndex((i) => i._id === over.id);
      return arrayMove(prev, oldIndex, newIndex);
    });
  };

  const handleSaveOrder = async () => {
    if (!api) return;
    setSavingOrder(true);

    const ordered = items.map((item, i) => ({ id: item._id, order: i }));
    const result = await api.PATCH<{ success: boolean }>({
      endpoint: "timeline/reorder",
      body: { items: ordered },
    });

    if ("code" in result) {
      toast.error("Failed to save order");
    } else {
      const updated = items.map((item, i) => ({ ...item, order: i }));
      setItems(updated);
      setOriginalOrder(updated);
      toast.success("Order saved");
    }
    setSavingOrder(false);
  };

  const handleResetOrder = () => {
    setItems(originalOrder);
  };

  const handleToggleActive = async (item: ITimelineItem) => {
    if (!api) return;
    setItems((prev) =>
      prev.map((i) =>
        i._id === item._id ? { ...i, isActive: !i.isActive } : i,
      ),
    );

    const result = await api.PATCH<{ timelineItem: ITimelineItem }>({
      endpoint: `timeline/${item._id}`,
      body: { toggleActive: true },
    });

    if ("code" in result) {
      toast.error("Failed to update");
      setItems((prev) =>
        prev.map((i) =>
          i._id === item._id ? { ...i, isActive: item.isActive } : i,
        ),
      );
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget || !api) return;
    setDeleting(true);

    const result = await api.DELETE<{ message: string }>({
      endpoint: `timeline/${deleteTarget._id}`,
    });

    if ("code" in result) {
      toast.error("Failed to delete");
    } else {
      setItems((prev) => prev.filter((i) => i._id !== deleteTarget._id));
      setOriginalOrder((prev) =>
        prev.filter((i) => i._id !== deleteTarget._id),
      );
      toast.success("Timeline item deleted");
    }
    setDeleting(false);
    setDeleteTarget(null);
  };

  const handleSaved = (updated: ITimelineItem) => {
    setItems((prev) => prev.map((i) => (i._id === updated._id ? updated : i)));
    setOriginalOrder((prev) =>
      prev.map((i) => (i._id === updated._id ? updated : i)),
    );
  };

  if (loadingSettings || loading) {
    return <TimelineLoadingSkeleton />;
  }

  if (!api) {
    return (
      <div className="flex flex-col gap-2 pb-8">
        <div className="flex items-center gap-2 px-4 border-b h-12 shrink-0">
          <Briefcase className="size-4 text-muted-foreground" />
          <span className="text-sm font-semibold flex-1">Timeline</span>
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
        <Briefcase className="size-4 text-muted-foreground" />
        <span className="text-sm font-semibold flex-1">Timeline</span>

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
            fetchItems();
          }}
        >
          <RefreshCw className={`size-3.5 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </Button>
        <Button size="sm" className="h-8 text-xs gap-1.5" asChild>
          <Link href="/dashboard/timeline/new">
            <Plus className="size-3.5" />
            New Item
          </Link>
        </Button>
      </div>

      <div className="px-4 flex flex-col gap-4 pt-3 flex-1 min-h-0 overflow-y-auto">
        <div className="flex items-baseline gap-8 flex-wrap">
          <Stat label="Total" value={stats.total} />
          <Stat label="Work" value={stats.work} />
          <Stat label="Education" value={stats.education} />
          <Stat label="Personal" value={stats.personal} />
        </div>

        <Separator />

        <Tabs
          value={categoryFilter}
          onValueChange={(v) => setCategoryFilter(v as CategoryFilter)}
        >
          <TabsList variant="line">
            <TabsTrigger value="all">
              All
              <span className="ml-1 text-[10px] text-muted-foreground tabular-nums">
                {stats.total}
              </span>
            </TabsTrigger>
            <TabsTrigger value="work">
              Work
              <span className="ml-1 text-[10px] text-muted-foreground tabular-nums">
                {stats.work}
              </span>
            </TabsTrigger>
            <TabsTrigger value="education">
              Education
              <span className="ml-1 text-[10px] text-muted-foreground tabular-nums">
                {stats.education}
              </span>
            </TabsTrigger>
            <TabsTrigger value="personal">
              Personal
              <span className="ml-1 text-[10px] text-muted-foreground tabular-nums">
                {stats.personal}
              </span>
            </TabsTrigger>
          </TabsList>
        </Tabs>

        {filteredItems.length === 0 ? (
          <div className="py-12 text-center text-muted-foreground text-sm">
            No timeline items found
          </div>
        ) : (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            modifiers={[restrictToVerticalAxis]}
            onDragEnd={handleDragEnd}
          >
            <SortableContext
              items={filteredItems.map((i) => i._id)}
              strategy={verticalListSortingStrategy}
            >
              <div className="flex flex-col">
                {filteredItems.map((item) => (
                  <SortableTimelineRow
                    key={item._id}
                    item={item}
                    onEdit={() => {
                      setEditItem(item);
                      setEditSheetOpen(true);
                    }}
                    onToggleActive={() => handleToggleActive(item)}
                    onDelete={() => setDeleteTarget(item)}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        )}
      </div>

      <TimelineEditorSheet
        item={editItem}
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
            <AlertDialogTitle>Delete timeline item?</AlertDialogTitle>
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

function SortableTimelineRow({
  item,
  onEdit,
  onToggleActive,
  onDelete,
}: {
  item: ITimelineItem;
  onEdit: () => void;
  onToggleActive: () => void;
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
    id: item._id,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : undefined,
  };

  return (
    <div ref={setNodeRef} style={style}>
      <TimelineRow
        item={item}
        onEdit={onEdit}
        onToggleActive={onToggleActive}
        onDelete={onDelete}
        dragHandleProps={{ ...attributes, ...listeners }}
      />
    </div>
  );
}

function TimelineRow({
  item,
  onEdit,
  onToggleActive,
  onDelete,
  dragHandleProps,
}: {
  item: ITimelineItem;
  onEdit: () => void;
  onToggleActive: () => void;
  onDelete: () => void;
  dragHandleProps?: Record<string, unknown>;
}) {
  return (
    <div
      className={`flex items-center gap-3 py-2.5 px-1 border-b transition-opacity cursor-pointer hover:bg-muted/50 ${
        !item.isActive ? "opacity-50" : ""
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

      {item.logoUrl ? (
        <img
          src={item.logoUrl}
          alt=""
          className="size-10 rounded-md object-cover shrink-0 border"
        />
      ) : (
        <div className="size-10 rounded-md bg-muted shrink-0 border flex items-center justify-center">
          <Briefcase className="size-4 text-muted-foreground" />
        </div>
      )}

      <div className="flex-1 min-w-0">
        <span className="text-sm font-medium truncate block">{item.title}</span>
        <span className="text-xs text-muted-foreground truncate block">
          {item.subtitle}
        </span>
        <span className="text-[10px] text-muted-foreground tabular-nums">
          {formatDateRange(item.dateFrom, item.dateTo)}
        </span>
      </div>

      {item.topics.length > 0 && (
        <span className="hidden md:inline text-[10px] text-muted-foreground tabular-nums shrink-0">
          {item.topics.length} {item.topics.length === 1 ? "topic" : "topics"}
        </span>
      )}

      <Badge
        variant={CATEGORY_VARIANTS[item.category]}
        className="text-[10px] shrink-0"
      >
        {CATEGORY_LABELS[item.category]}
      </Badge>

      {!item.isActive && (
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
              onToggleActive();
            }}
          >
            {item.isActive ? (
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
