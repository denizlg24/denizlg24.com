"use client";

import type { IBlog } from "@repo/schemas";
import { NotebookPen } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import {
  DetailNotFound,
  DetailPageShell,
  DetailPageSkeleton,
} from "../detail-page-shell";
import { useAdmin } from "../provider";
import { BlogForm } from "./blog-form";

const ICON = <NotebookPen className="size-4 text-muted-foreground" />;

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

  const title = mode === "edit" ? "Edit Post" : "New Post";
  const shell = { icon: ICON, backTo, backLabel: "Posts" } as const;

  if (loading) return <DetailPageSkeleton {...shell} title={title} rows={2} />;

  if (mode === "edit" && !blog) {
    return (
      <DetailNotFound
        {...shell}
        title="Post not found"
        message="This post could not be loaded."
      />
    );
  }

  return (
    <DetailPageShell {...shell} title={mode === "edit" ? blog?.title : title}>
      <BlogForm
        mode={mode}
        blog={blog ?? undefined}
        onSuccess={() => router.push(backTo)}
        onCancel={() => router.push(backTo)}
      />
    </DetailPageShell>
  );
}
