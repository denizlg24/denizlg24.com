"use client";

import type { IBlog } from "@repo/schemas";
import { ScrollArea } from "@repo/ui/scroll-area";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@repo/ui/sheet";
import { BlogForm } from "./blog-form";

export function BlogEditorSheet({
  blog,
  open,
  onOpenChange,
  onSaved,
}: {
  blog: IBlog | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: (blog: IBlog) => void;
}) {
  if (!blog) return null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-2xl overflow-hidden p-0">
        <SheetHeader className="px-4 pt-4 pb-0">
          <SheetTitle className="text-sm">Edit Post</SheetTitle>
          <SheetDescription className="sr-only">
            Edit blog post: {blog.title}
          </SheetDescription>
        </SheetHeader>
        <ScrollArea className="h-[calc(100vh-4rem)] px-4 pb-6">
          <BlogForm
            mode="edit"
            blog={blog}
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
