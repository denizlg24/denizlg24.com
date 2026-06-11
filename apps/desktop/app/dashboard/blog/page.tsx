"use client";

import type { ColumnDef } from "@tanstack/react-table";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Eye,
  EyeOff,
  MoreHorizontal,
  NotebookPen,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
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
import { PaginatedDataTable } from "@/components/ui/paginated-data-table";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useUserSettings } from "@/context/user-context";
import { denizApi } from "@/lib/api-wrapper";
import type { IBlog } from "@/lib/data-types";
import { BlogEditorSheet } from "./_components/blog-editor-sheet";

type StatusFilter = "all" | "published" | "draft";

function formatRelativeDate(dateStr: string): string {
  const now = new Date();
  const date = new Date(dateStr);
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60_000);
  const diffHours = Math.floor(diffMs / 3_600_000);
  const diffDays = Math.floor(diffMs / 86_400_000);

  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;

  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: date.getFullYear() !== now.getFullYear() ? "numeric" : undefined,
  });
}

function SortHeader({
  label,
  column,
}: {
  label: string;
  column: {
    getIsSorted: () => false | "asc" | "desc";
    toggleSorting: (desc: boolean) => void;
  };
}) {
  const sorted = column.getIsSorted();
  return (
    <button
      type="button"
      className="flex items-center gap-1 hover:text-foreground transition-colors"
      onClick={() => column.toggleSorting(sorted === "asc")}
    >
      {label}
      {sorted === "asc" ? (
        <ArrowUp className="size-3" />
      ) : sorted === "desc" ? (
        <ArrowDown className="size-3" />
      ) : (
        <ArrowUpDown className="size-3 opacity-40" />
      )}
    </button>
  );
}

function BlogLoadingSkeleton() {
  return (
    <div className="flex flex-col gap-2 pb-8">
      <div className="flex items-center gap-2 px-4 border-b h-12 shrink-0">
        <NotebookPen className="size-4 text-muted-foreground" />
        <span className="text-sm font-semibold flex-1">Blog Posts</span>
      </div>
      <div className="px-4 flex flex-col gap-6 pt-3">
        <div className="flex items-baseline gap-8">
          {[1, 2, 3].map((i) => (
            <div key={i} className="flex flex-col gap-1">
              <Skeleton className="h-3 w-14" />
              <Skeleton className="h-6 w-8" />
            </div>
          ))}
        </div>
        <Skeleton className="h-9 w-64 rounded-lg" />
        <div className="flex flex-col">
          <Skeleton className="h-10 w-full" />
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="flex items-center gap-3 py-3 border-b">
              <Skeleton className="h-4 w-48 flex-1" />
              <Skeleton className="h-4 w-16" />
              <Skeleton className="h-5 w-16 rounded-full" />
              <Skeleton className="h-4 w-12" />
              <Skeleton className="h-4 w-16" />
              <Skeleton className="h-6 w-6 rounded" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function BlogPage() {
  const { settings, loading: loadingSettings } = useUserSettings();

  const api = useMemo(() => {
    if (loadingSettings) return null;
    return new denizApi(settings.apiKey);
  }, [settings, loadingSettings]);

  const [blogs, setBlogs] = useState<IBlog[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<StatusFilter>("all");
  const [editBlog, setEditBlog] = useState<IBlog | null>(null);
  const [editSheetOpen, setEditSheetOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<IBlog | null>(null);
  const [deleting, setDeleting] = useState(false);

  const fetchBlogs = useCallback(async () => {
    if (!api) return;
    const result = await api.GET<{ blogs: IBlog[] }>({
      endpoint: "blogs",
    });
    if (!("code" in result)) {
      setBlogs(result.blogs);
    } else {
      toast.error("Failed to load posts");
    }
    setLoading(false);
  }, [api]);

  useEffect(() => {
    fetchBlogs();
  }, [fetchBlogs]);

  const stats = useMemo(() => {
    const published = blogs.filter((b) => b.isActive).length;
    return { total: blogs.length, published, draft: blogs.length - published };
  }, [blogs]);

  const filteredBlogs = useMemo(() => {
    if (filter === "all") return blogs;
    if (filter === "published") return blogs.filter((b) => b.isActive);
    return blogs.filter((b) => !b.isActive);
  }, [blogs, filter]);

  const handleToggleActive = async (e: React.MouseEvent, blog: IBlog) => {
    e.stopPropagation();
    if (!api) return;

    setBlogs((prev) =>
      prev.map((b) =>
        b._id === blog._id ? { ...b, isActive: !b.isActive } : b,
      ),
    );

    const result = await api.PATCH<{ blog: IBlog }>({
      endpoint: `blogs/${blog._id}`,
      body: { toggleActive: true },
    });

    if ("code" in result) {
      toast.error("Failed to update status");
      setBlogs((prev) =>
        prev.map((b) =>
          b._id === blog._id ? { ...b, isActive: blog.isActive } : b,
        ),
      );
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget || !api) return;
    setDeleting(true);

    const result = await api.DELETE<{ message: string }>({
      endpoint: `blogs/${deleteTarget._id}`,
    });

    if ("code" in result) {
      toast.error("Failed to delete post");
    } else {
      setBlogs((prev) => prev.filter((b) => b._id !== deleteTarget._id));
      toast.success("Post deleted");
    }
    setDeleting(false);
    setDeleteTarget(null);
  };

  const handleRowClick = (blog: IBlog) => {
    setEditBlog(blog);
    setEditSheetOpen(true);
  };

  const handleSaved = (updated: IBlog) => {
    setBlogs((prev) => prev.map((b) => (b._id === updated._id ? updated : b)));
  };

  const columns: ColumnDef<IBlog, unknown>[] = [
    {
      accessorKey: "title",
      header: ({ column }) => <SortHeader label="Title" column={column} />,
      cell: ({ row }) => (
        <div className="min-w-0">
          <span className="font-medium block truncate max-w-[300px]">
            {row.getValue("title")}
          </span>
          <span className="text-[10px] text-muted-foreground font-mono">
            /{row.original.slug}
          </span>
        </div>
      ),
    },
    {
      accessorKey: "tags",
      header: "Tags",
      cell: ({ row }) => {
        const tags = row.original.tags ?? [];
        if (!tags.length)
          return <span className="text-muted-foreground">-</span>;
        return (
          <div className="flex gap-1 flex-wrap max-w-[150px]">
            {tags.slice(0, 3).map((tag) => (
              <Badge
                key={tag}
                variant="secondary"
                className="text-[10px] px-1.5 py-0"
              >
                {tag}
              </Badge>
            ))}
            {tags.length > 3 && (
              <span className="text-[10px] text-muted-foreground">
                +{tags.length - 3}
              </span>
            )}
          </div>
        );
      },
    },
    {
      accessorKey: "isActive",
      header: "Status",
      cell: ({ row }) =>
        row.original.isActive ? (
          <Badge variant="default" className="text-[10px]">
            Published
          </Badge>
        ) : (
          <Badge variant="outline" className="text-[10px]">
            Draft
          </Badge>
        ),
    },
    {
      accessorKey: "timeToRead",
      header: "Read",
      cell: ({ row }) => (
        <span className="text-muted-foreground tabular-nums">
          {row.original.timeToRead}m
        </span>
      ),
    },
    {
      accessorKey: "createdAt",
      header: ({ column }) => <SortHeader label="Created" column={column} />,
      cell: ({ row }) => (
        <span className="text-muted-foreground">
          {formatRelativeDate(row.getValue("createdAt"))}
        </span>
      ),
    },
    {
      id: "actions",
      header: "",
      cell: ({ row }) => {
        const blog = row.original;
        return (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 w-7 p-0"
                onClick={(e) => e.stopPropagation()}
              >
                <MoreHorizontal className="size-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                onClick={(e) => {
                  e.stopPropagation();
                  handleRowClick(blog);
                }}
              >
                <Pencil className="size-3.5" />
                Edit
              </DropdownMenuItem>
              <DropdownMenuItem onClick={(e) => handleToggleActive(e, blog)}>
                {blog.isActive ? (
                  <>
                    <EyeOff className="size-3.5" />
                    Unpublish
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
                  setDeleteTarget(blog);
                }}
              >
                <Trash2 className="size-3.5" />
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        );
      },
    },
  ];

  if (loadingSettings || loading) {
    return <BlogLoadingSkeleton />;
  }

  if (!api) {
    return (
      <div className="flex flex-col gap-2 pb-8">
        <div className="flex items-center gap-2 px-4 border-b h-12 shrink-0">
          <NotebookPen className="size-4 text-muted-foreground" />
          <span className="text-sm font-semibold flex-1">Blog Posts</span>
        </div>
        <div className="px-4 pt-12 text-center text-muted-foreground text-sm">
          Failed to initialize API client.
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-2 overflow-hidden">
      <div className="flex items-center gap-2 px-4 border-b h-12 shrink-0">
        <NotebookPen className="size-4 text-muted-foreground" />
        <span className="text-sm font-semibold flex-1">Blog Posts</span>
        <Button
          variant="ghost"
          size="sm"
          className="h-8 text-xs gap-1.5"
          onClick={() => {
            setLoading(true);
            fetchBlogs();
          }}
        >
          <RefreshCw className={`size-3.5 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </Button>
        <Button size="sm" className="h-8 text-xs gap-1.5" asChild>
          <Link href="/dashboard/blog/new">
            <Plus className="size-3.5" />
            New Post
          </Link>
        </Button>
      </div>

      <div className="px-4 flex flex-1 min-h-0 flex-col gap-4 overflow-hidden pt-3 pb-8">
        <div className="flex items-baseline gap-8 flex-wrap">
          <Stat label="Total" value={stats.total} />
          <Stat label="Published" value={stats.published} />
          <Stat
            label="Drafts"
            value={stats.draft}
            highlight={stats.draft > 0}
          />
        </div>

        <Separator />

        <Tabs
          value={filter}
          onValueChange={(v) => setFilter(v as StatusFilter)}
        >
          <TabsList variant="line">
            <TabsTrigger value="all">
              All
              <span className="ml-1 text-[10px] text-muted-foreground tabular-nums">
                {stats.total}
              </span>
            </TabsTrigger>
            <TabsTrigger value="published">
              Published
              <span className="ml-1 text-[10px] text-muted-foreground tabular-nums">
                {stats.published}
              </span>
            </TabsTrigger>
            <TabsTrigger value="draft">
              Drafts
              <span className="ml-1 text-[10px] text-muted-foreground tabular-nums">
                {stats.draft}
              </span>
            </TabsTrigger>
          </TabsList>
        </Tabs>

        <div className="min-h-0 flex-1">
          <PaginatedDataTable
            columns={columns}
            data={filteredBlogs}
            emptyMessage="No posts found"
            initialSorting={[{ id: "createdAt", desc: true }]}
            onRowClick={handleRowClick}
          />
        </div>
      </div>

      <BlogEditorSheet
        blog={editBlog}
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
            <AlertDialogTitle>Delete post?</AlertDialogTitle>
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
        className={`text-lg font-semibold tabular-nums tracking-tight ${
          highlight ? "text-primary" : ""
        }`}
      >
        {value}
      </p>
    </div>
  );
}
