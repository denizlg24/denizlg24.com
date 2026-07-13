"use client";

import type { IBlog } from "@repo/schemas";
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
      <SheetContent
        side="bottom"
        className="w-full pt-0 px-4 pb-6 max-w-full! overflow-x-auto overflow-y-auto max-h-[calc(100vh-var(--titlebar-inset,0px))]!"
      >
        <SheetHeader className="px-4 pt-4 pb-0">
          <SheetTitle className="text-sm">Edit Post</SheetTitle>
          <SheetDescription className="sr-only">
            Edit blog post: {blog.title}
          </SheetDescription>
        </SheetHeader>
        <BlogForm
          mode="edit"
          blog={blog}
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
