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
import type { ITimelineItem } from "@repo/schemas";
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
  GripVertical,
  Milestone,
  Pencil,
  Plus,
  RefreshCw,
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
import { formatTimelineRange } from "./timeline-dates";

type Category = ITimelineItem["category"];
type CategoryFilter = "all" | Category;

const CATEGORY_LABELS: Record<Category, string> = {
  work: "Work",
  education: "Education",
  personal: "Personal",
};

const ICON = <Milestone />;

function TimelineHeader({ children }: { children?: ReactNode }) {
  const { slots } = useAdmin();
  return (
    <PageHeader leading={slots?.sidebarTrigger} icon={ICON} title="Timeline">
      {children}
    </PageHeader>
  );
}

export function TimelineSkeleton() {
  return (
    <Page>
      <TimelineHeader />
      <PageToolbar>
        <Skeleton className="h-7 w-56" />
        <Skeleton className="h-5 w-72" />
      </PageToolbar>
      <PageBody>
        <div className="flex flex-col gap-1">
          {Array.from({ length: 8 }).map((_, index) => (
            <div key={index} className="flex h-12 items-center gap-3">
              <Skeleton className="size-5 rounded" />
              <div className="flex flex-1 flex-col gap-1.5">
                <Skeleton className="h-3.5 w-48" />
                <Skeleton className="h-3 w-32" />
              </div>
              <Skeleton className="h-3 w-28" />
              <Skeleton className="h-5 w-16" />
            </div>
          ))}
        </div>
      </PageBody>
    </Page>
  );
}

function matchesQuery(item: ITimelineItem, query: string): boolean {
  if (!query) return true;
  const needle = query.toLowerCase();
  return (
    item.title.toLowerCase().includes(needle) ||
    item.subtitle.toLowerCase().includes(needle) ||
    item.topics.some((topic) => topic.toLowerCase().includes(needle))
  );
}

export function TimelinePage() {
  const { client, routes } = useAdmin();
  const router = useRouter();

  const [items, setItems] = useState<ITimelineItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>("all");
  const [query, setQuery] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<ITimelineItem | null>(null);
  const [originalOrder, setOriginalOrder] = useState<ITimelineItem[]>([]);
  const [savingOrder, setSavingOrder] = useState(false);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const fetchItems = useCallback(async () => {
    try {
      const result = await client.get<{ items: ITimelineItem[] }>("timeline");
      const sorted = [...result.items].sort((a, b) => a.order - b.order);
      setItems(sorted);
      setOriginalOrder(sorted);
    } catch {
      toast.error("Failed to load timeline");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [client]);

  useEffect(() => {
    void fetchItems();
  }, [fetchItems]);

  const counts = useMemo(
    () => ({
      all: items.length,
      work: items.filter((i) => i.category === "work").length,
      education: items.filter((i) => i.category === "education").length,
      personal: items.filter((i) => i.category === "personal").length,
    }),
    [items],
  );

  const trimmedQuery = query.trim();
  const visibleItems = useMemo(
    () =>
      items.filter(
        (item) =>
          (categoryFilter === "all" || item.category === categoryFilter) &&
          matchesQuery(item, trimmedQuery),
      ),
    [items, categoryFilter, trimmedQuery],
  );

  // A search hides rows between neighbours, so a drop would land somewhere unseen.
  const sortable = !trimmedQuery;

  const hasOrderChanges = useMemo(() => {
    if (items.length !== originalOrder.length) return false;
    return items.some((item, i) => item._id !== originalOrder[i]?._id);
  }, [items, originalOrder]);

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setItems((prev) => {
      const oldIndex = prev.findIndex((i) => i._id === active.id);
      const newIndex = prev.findIndex((i) => i._id === over.id);
      if (oldIndex < 0 || newIndex < 0) return prev;
      return arrayMove(prev, oldIndex, newIndex);
    });
  };

  const handleSaveOrder = async () => {
    setSavingOrder(true);
    const ordered = items.map((item, i) => ({ _id: item._id, order: i }));
    try {
      await client.patch<{ success: boolean }>("timeline/reorder", {
        items: ordered,
      });
      const updated = items.map((item, i) => ({ ...item, order: i }));
      setItems(updated);
      setOriginalOrder(updated);
      toast.success("Order saved");
    } catch {
      toast.error("Failed to save order");
    }
    setSavingOrder(false);
  };

  const setActiveLocal = (id: string, isActive: boolean) => {
    const apply = (list: ITimelineItem[]) =>
      list.map((i) => (i._id === id ? { ...i, isActive } : i));
    setItems(apply);
    setOriginalOrder(apply);
  };

  const handleToggleActive = async (item: ITimelineItem) => {
    setActiveLocal(item._id, !item.isActive);
    try {
      await client.patch<{ item: ITimelineItem }>(`timeline/${item._id}`, {
        toggleActive: true,
      });
    } catch {
      toast.error("Failed to update");
      setActiveLocal(item._id, item.isActive);
    }
  };

  const handleDelete = async () => {
    const target = deleteTarget;
    if (!target) return;
    setDeleteTarget(null);
    try {
      await client.del<{ success: boolean }>(`timeline/${target._id}`);
      setItems((prev) => prev.filter((i) => i._id !== target._id));
      setOriginalOrder((prev) => prev.filter((i) => i._id !== target._id));
      toast.success("Entry deleted");
    } catch {
      toast.error("Failed to delete");
    }
  };

  if (loading) return <TimelineSkeleton />;

  const rowProps = (item: ITimelineItem) => ({
    item,
    onEdit: () => router.push(routes.timeline.edit(item._id)),
    onToggleActive: () => void handleToggleActive(item),
    onDelete: () => setDeleteTarget(item),
  });

  return (
    <Page>
      <TimelineHeader>
        {hasOrderChanges ? (
          <>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setItems(originalOrder)}
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
            void fetchItems();
          }}
        >
          <RefreshCw className={cn(refreshing && "animate-spin")} />
        </Button>
        <Button size="sm" asChild>
          <Link href={routes.timeline.new}>
            <Plus />
            New entry
          </Link>
        </Button>
      </TimelineHeader>

      <PageToolbar>
        <SearchField
          value={query}
          onChange={setQuery}
          placeholder="Search title, topic"
          className="w-64"
        />
        <FilterTabs<CategoryFilter>
          value={categoryFilter}
          onChange={setCategoryFilter}
          options={[
            { value: "all", label: "All", count: counts.all },
            { value: "work", label: "Work", count: counts.work },
            { value: "education", label: "Education", count: counts.education },
            { value: "personal", label: "Personal", count: counts.personal },
          ]}
        />
        <ToolbarSpacer />
      </PageToolbar>

      <PageBody>
        {items.length === 0 ? (
          <EmptyState
            icon={ICON}
            label="No entries"
            action={
              <Button size="sm" variant="outline" asChild>
                <Link href={routes.timeline.new}>
                  <Plus />
                  New entry
                </Link>
              </Button>
            }
          />
        ) : visibleItems.length === 0 ? (
          <EmptyState icon={ICON} label="No matching entries" />
        ) : sortable ? (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            modifiers={[restrictToVerticalAxis]}
            onDragEnd={handleDragEnd}
          >
            <SortableContext
              items={visibleItems.map((i) => i._id)}
              strategy={verticalListSortingStrategy}
            >
              <List>
                {visibleItems.map((item) => (
                  <SortableTimelineRow key={item._id} {...rowProps(item)} />
                ))}
              </List>
            </SortableContext>
          </DndContext>
        ) : (
          <List>
            {visibleItems.map((item) => (
              <TimelineRow key={item._id} {...rowProps(item)} />
            ))}
          </List>
        )}
      </PageBody>

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
        title="Delete entry?"
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

interface TimelineRowProps {
  item: ITimelineItem;
  onEdit: () => void;
  onToggleActive: () => void;
  onDelete: () => void;
}

function SortableTimelineRow(props: TimelineRowProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: props.item._id });

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn("relative", isDragging && "z-10 opacity-60")}
    >
      <TimelineRow
        {...props}
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
}: TimelineRowProps & {
  dragHandleProps?: HTMLAttributes<HTMLButtonElement>;
}) {
  return (
    <ListRow
      onClick={onEdit}
      className={cn("min-h-12", !item.isActive && "opacity-60")}
      leading={
        item.logoUrl ? (
          <img
            src={item.logoUrl}
            alt=""
            className="size-5 rounded object-cover"
          />
        ) : (
          <Milestone />
        )
      }
      title={item.title}
      description={item.subtitle}
      meta={
        <>
          {item.topics.length > 0 ? (
            <span className="hidden md:inline">
              {item.topics.length}{" "}
              {item.topics.length === 1 ? "topic" : "topics"}
            </span>
          ) : null}
          <span className="hidden sm:inline">
            {formatTimelineRange(item.dateFrom, item.dateTo)}
          </span>
          <Badge variant="secondary">{CATEGORY_LABELS[item.category]}</Badge>
          {item.isActive ? null : <Badge variant="outline">Hidden</Badge>}
        </>
      }
      trailing={
        <>
          {dragHandleProps ? (
            <button
              type="button"
              aria-label={`Reorder ${item.title}`}
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
            <DropdownMenuItem onClick={onToggleActive}>
              {item.isActive ? <EyeOff /> : <Eye />}
              {item.isActive ? "Hide" : "Publish"}
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
