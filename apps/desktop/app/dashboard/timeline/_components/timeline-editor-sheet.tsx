"use client";

import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import type { denizApi } from "@/lib/api-wrapper";
import type { ITimelineItem } from "@/lib/data-types";
import { TimelineForm } from "./timeline-form";

export function TimelineEditorSheet({
  item,
  open,
  onOpenChange,
  api,
  onSaved,
}: {
  item: ITimelineItem | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  api: denizApi;
  onSaved: (item: ITimelineItem) => void;
}) {
  if (!item) return null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-xl overflow-hidden p-0">
        <SheetHeader className="px-4 pt-4 pb-0">
          <SheetTitle className="text-sm">Edit Timeline Item</SheetTitle>
          <SheetDescription className="sr-only">
            Edit timeline item: {item.title}
          </SheetDescription>
        </SheetHeader>
        <ScrollArea className="h-[calc(100vh-4rem)] px-4 pb-6">
          <TimelineForm
            mode="edit"
            item={item}
            api={api}
            onSuccess={(updated) => {
              onSaved(updated);
              onOpenChange(false);
            }}
            onCancel={() => onOpenChange(false)}
          />
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}
