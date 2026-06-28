"use client";

import type { ITimelineItem } from "@repo/schemas";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@repo/ui/sheet";
import { TimelineForm } from "./timeline-form";

export function TimelineEditorSheet({
  item,
  open,
  onOpenChange,
  onSaved,
}: {
  item: ITimelineItem | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: (item: ITimelineItem) => void;
}) {
  if (!item) return null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="w-full p-0 max-w-full! overflow-x-auto px-2 pb-2 overflow-y-auto max-h-screen!"
      >
        <SheetHeader className="px-4 pt-4 pb-0">
          <SheetTitle className="text-sm">Edit Timeline Item</SheetTitle>
          <SheetDescription className="sr-only">
            Edit timeline item: {item.title}
          </SheetDescription>
        </SheetHeader>
        <TimelineForm
          mode="edit"
          item={item}
          onSuccess={(updated) => {
            onSaved(updated);
            onOpenChange(false);
          }}
          onCancel={() => onOpenChange(false)}
        />
      </SheetContent>
    </Sheet>
  );
}
