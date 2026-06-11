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
import type { IBlog } from "@/lib/data-types";
import { BlogForm } from "./blog-form";

export function BlogEditorSheet({
  blog,
  open,
  onOpenChange,
  api,
  onSaved,
}: {
  blog: IBlog | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  api: denizApi;
  onSaved: (blog: IBlog) => void;
}) {
  if (!blog) return null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-2xl overflow-hidden p-0">
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
