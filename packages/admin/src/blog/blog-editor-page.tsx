"use client";

import type { IBlog } from "@repo/schemas";
import { NotebookPen } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import {
  DocumentEditorSkeleton,
  DocumentNotFound,
} from "../projects/document-editor";
import { useAdmin } from "../provider";
import { BlogForm } from "./blog-form";

const ICON = <NotebookPen />;

export function BlogEditorPage({
  mode,
  blogId,
}: {
  mode: "create" | "edit";
  blogId?: string;
}) {
  const { client, routes } = useAdmin();
  const router = useRouter();
  const backTo = routes.blog.root;

  const [blog, setBlog] = useState<IBlog | null>(null);
  const [loading, setLoading] = useState(mode === "edit");

  const load = useCallback(async () => {
    if (mode !== "edit" || !blogId) return;
    setLoading(true);
    try {
      const result = await client.get<{ blog: IBlog }>(`blogs/${blogId}`);
      setBlog(result.blog);
    } catch {
      toast.error("Failed to load post");
      setBlog(null);
    } finally {
      setLoading(false);
    }
  }, [client, blogId, mode]);

  useEffect(() => {
    void load();
  }, [load]);

  const shell = { icon: ICON, backTo, backLabel: "Blog" } as const;

  if (loading) {
    return <DocumentEditorSkeleton {...shell} title="Post" properties={5} />;
  }

  if (mode === "edit" && !blog) {
    return <DocumentNotFound {...shell} label="Post not found" />;
  }

  return (
    <BlogForm
      key={blog?._id ?? "new"}
      mode={mode}
      blog={blog ?? undefined}
      {...shell}
      onSuccess={() => router.push(backTo)}
      onDeleted={() => router.push(backTo)}
    />
  );
}
