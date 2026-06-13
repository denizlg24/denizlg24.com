"use client";

import { Badge } from "@repo/ui/badge";
import { Button } from "@repo/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@repo/ui/dialog";
import {
  ExternalLink,
  Eye,
  EyeOff,
  GripVertical,
  NotepadText,
  Pencil,
  Trash2,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";
import { FaGithub } from "react-icons/fa6";
import {
  Sortable,
  SortableContent,
  SortableItem,
  SortableItemHandle,
} from "@/components/ui/sortable";
import type { ITimelineItemLean } from "@/models/TimelineItem";

interface TimelineListProps {
  items: ITimelineItemLean[];
  onRefresh?: () => void;
  enableReorder?: boolean;
  onReorder?: (items: ITimelineItemLean[]) => void;
}

export const TimelineList = ({
  items,
  onRefresh,
  enableReorder = false,
  onReorder,
}: TimelineListProps) => {
  const [deletingItem, setDeletingItem] = useState<ITimelineItemLean | null>(
    null,
  );
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [localItems, setLocalItems] = useState(items);

  useEffect(() => {
    setLocalItems(items);
  }, [items]);

  const handleToggleActive = async (id: string) => {
    setTogglingId(id);
    try {
      const response = await fetch(`/api/admin/timeline/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ toggleActive: true }),
      });

      if (!response.ok) {
        throw new Error("Failed to toggle active status");
      }

      onRefresh?.();
    } catch (error) {
      console.error("Error toggling active status:", error);
    } finally {
      setTogglingId(null);
    }
  };

  const handleDelete = async () => {
    if (!deletingItem) return;

    setIsDeleting(true);
    try {
      const response = await fetch(`/api/admin/timeline/${deletingItem._id}`, {
        method: "DELETE",
      });

      if (!response.ok) {
        throw new Error("Failed to delete item");
      }

      onRefresh?.();
      setDeletingItem(null);
    } catch (error) {
      console.error("Error deleting item:", error);
    } finally {
      setIsDeleting(false);
    }
  };

  const handleReorder = (newItems: ITimelineItemLean[]) => {
    setLocalItems(newItems);
    onReorder?.(newItems);
  };

  if (items.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        <p>No timeline items yet. Create your first one!</p>
      </div>
    );
  }

  const renderItem = (item: ITimelineItemLean, isDragging?: boolean) => (
    <div
      className={`border-b-2 border-muted pb-2 transition-opacity ${
        !item.isActive ? "opacity-50" : ""
      } ${isDragging ? "shadow-lg" : ""}`}
    >
      <div className="flex items-start justify-between gap-4">
        {enableReorder && (
          <SortableItemHandle className="flex items-center">
            <GripVertical className="w-5 h-5 text-muted-foreground hover:text-foreground transition-colors" />
          </SortableItemHandle>
        )}

        <div className="flex-1 flex gap-4">
          {item.logoUrl && (
            <div className="relative w-12 h-12 rounded-lg overflow-hidden shrink-0">
              <Image
                src={item.logoUrl}
                alt={`${item.title} logo`}
                fill
                className="object-cover"
              />
            </div>
          )}

          <div className="flex-1 space-y-2">
            <div>
              <h3 className="text-xl font-semibold">{item.title}</h3>
              <p className="text-muted-foreground">{item.subtitle}</p>
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm text-muted-foreground">
                {item.dateFrom} - {item.dateTo || "Present"}
              </span>
              <Badge variant="secondary">{item.category}</Badge>
            </div>

            {item.topics.length > 0 && (
              <div className="space-y-1">
                {item.topics.slice(0, 2).map((topic, idx) => (
                  <p key={idx} className="text-sm">
                    • {topic}
                  </p>
                ))}
                {item.topics.length > 2 && (
                  <p className="text-sm text-muted-foreground">
                    +{item.topics.length - 2} more topics
                  </p>
                )}
              </div>
            )}

            {item.links && item.links.length > 0 && (
              <div className="flex gap-2 flex-wrap">
                {item.links.map((link, idx) => (
                  <a
                    key={idx}
                    href={link.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs px-2 py-1 border border-accent rounded hover:bg-accent transition-colors inline-flex items-center gap-1"
                    title={`Icon: ${link.icon || "external"}`}
                  >
                    {link.label}{" "}
                    {link.icon === "external" ? (
                      <ExternalLink className="w-3.5 h-3.5" />
                    ) : link.icon === "github" ? (
                      <FaGithub className="w-3.5 h-3.5" />
                    ) : (
                      <NotepadText className="w-3.5 h-3.5" />
                    )}
                  </a>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => handleToggleActive(item._id)}
            disabled={togglingId === item._id}
          >
            {item.isActive ? (
              <Eye className="w-4 h-4" />
            ) : (
              <EyeOff className="w-4 h-4" />
            )}
          </Button>
          <Button variant="outline" size="sm" asChild>
            <Link href={`/admin/dashboard/timeline/${item._id}/edit`}>
              <Pencil className="w-4 h-4" />
            </Link>
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setDeletingItem(item)}
          >
            <Trash2 className="w-4 h-4 text-destructive" />
          </Button>
        </div>
      </div>
    </div>
  );

  return (
    <>
      <div className="w-full flex flex-col gap-4">
        {enableReorder ? (
          <Sortable
            value={localItems}
            onValueChange={handleReorder}
            getItemValue={(item: ITimelineItemLean) => item._id}
          >
            <SortableContent className="w-full flex flex-col gap-4">
              {localItems.map((item) => (
                <SortableItem key={item._id} value={item._id}>
                  {renderItem(item)}
                </SortableItem>
              ))}
            </SortableContent>
          </Sortable>
        ) : (
          items.map((item) => <div key={item._id}>{renderItem(item)}</div>)
        )}
      </div>

      <Dialog open={!!deletingItem} onOpenChange={() => setDeletingItem(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Timeline Item</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete "{deletingItem?.title}"? This
              action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDeletingItem(null)}
              disabled={isDeleting}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={isDeleting}
            >
              {isDeleting ? "Deleting..." : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};
