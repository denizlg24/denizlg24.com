"use client";

import type { IBlog } from "@repo/schemas";
import { Badge } from "@repo/ui/badge";
import { Button } from "@repo/ui/button";
import { ConfirmDialog } from "@repo/ui/confirm-button";
import { SortHeader } from "@repo/ui/data-table";
import {
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@repo/ui/dropdown-menu";
import { EmptyState } from "@repo/ui/empty-state";
import { Page, PageBody, PageHeader, PageToolbar } from "@repo/ui/page";
import { PaginatedDataTable } from "@repo/ui/paginated-data-table";
import { Skeleton } from "@repo/ui/skeleton";
import { TableSkeleton } from "@repo/ui/skeleton-blocks";
import {
  FilterTabs,
  RowActions,
  SearchField,
  ToolbarSpacer,
} from "@repo/ui/toolbar";
import { cn } from "@repo/ui/utils";
import type { ColumnDef } from "@tanstack/react-table";
import {
  Eye,
  EyeOff,
  NotebookPen,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { toast } from "sonner";
import { formatRelativeDate } from "../projects/document-editor";
import { useAdmin } from "../provider";

type StatusFilter = "all" | "published" | "draft";

const ICON = <NotebookPen />;

function BlogHeader({ children }: { children?: ReactNode }) {
  const { slots } = useAdmin();
  return (
    <PageHeader leading={slots?.sidebarTrigger} icon={ICON} title="Blog">
      {children}
    </PageHeader>
  );
}

export function BlogSkeleton() {
  return (
    <Page>
      <BlogHeader />
      <PageToolbar>
        <Skeleton className="h-7 w-56" />
        <Skeleton className="h-5 w-48" />
      </PageToolbar>
      <PageBody width="wide">
        <TableSkeleton
          rows={8}
          widths={["flex-1", "w-24", "w-16", "w-10", "w-16", "w-8"]}
        />
      </PageBody>
    </Page>
  );
}

function matchesQuery(blog: IBlog, query: string): boolean {
  if (!query) return true;
  const needle = query.toLowerCase();
  return (
    blog.title.toLowerCase().includes(needle) ||
    blog.slug.toLowerCase().includes(needle) ||
    (blog.tags ?? []).some((tag) => tag.includes(needle))
  );
}

export function BlogPage() {
  const { client, routes } = useAdmin();
  const router = useRouter();

  const [blogs, setBlogs] = useState<IBlog[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState<StatusFilter>("all");
  const [query, setQuery] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<IBlog | null>(null);

  const fetchBlogs = useCallback(async () => {
    try {
      const result = await client.get<{ blogs: IBlog[] }>("blogs");
      setBlogs(result.blogs);
    } catch {
      toast.error("Failed to load posts");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [client]);

  useEffect(() => {
    void fetchBlogs();
  }, [fetchBlogs]);

  const counts = useMemo(() => {
    const published = blogs.filter((b) => b.isActive).length;
    return { all: blogs.length, published, draft: blogs.length - published };
  }, [blogs]);

  const visibleBlogs = useMemo(
    () =>
      blogs.filter((blog) => {
        if (filter === "published" && !blog.isActive) return false;
        if (filter === "draft" && blog.isActive) return false;
        return matchesQuery(blog, query.trim());
      }),
    [blogs, filter, query],
  );

  const handleToggleActive = useCallback(
    async (blog: IBlog) => {
      setBlogs((prev) =>
        prev.map((b) =>
          b._id === blog._id ? { ...b, isActive: !blog.isActive } : b,
        ),
      );
      try {
        await client.patch<{ blog: IBlog }>(`blogs/${blog._id}`, {
          toggleActive: true,
        });
      } catch {
        toast.error("Failed to update status");
        setBlogs((prev) =>
          prev.map((b) =>
            b._id === blog._id ? { ...b, isActive: blog.isActive } : b,
          ),
        );
      }
    },
    [client],
  );

  const handleDelete = async () => {
    const target = deleteTarget;
    if (!target) return;
    setDeleteTarget(null);
    try {
      await client.del<{ message: string }>(`blogs/${target._id}`);
      setBlogs((prev) => prev.filter((b) => b._id !== target._id));
      toast.success("Post deleted");
    } catch {
      toast.error("Failed to delete post");
    }
  };

  const openPost = useCallback(
    (blog: IBlog) => router.push(routes.blog.edit(blog._id)),
    [router, routes],
  );

  const columns = useMemo<ColumnDef<IBlog, unknown>[]>(
    () => [
      {
        accessorKey: "title",
        header: ({ column }) => <SortHeader label="Title" column={column} />,
        cell: ({ row }) => (
          <div className="flex min-w-0 flex-col">
            <span className="max-w-[28rem] truncate text-accent-strong">
              {row.original.title}
            </span>
            <span className="truncate font-mono text-[11px] text-muted-foreground">
              /{row.original.slug}
            </span>
          </div>
        ),
      },
      {
        accessorKey: "tags",
        meta: { className: "hidden lg:table-cell" },
        header: "Tags",
        enableSorting: false,
        cell: ({ row }) => {
          const tags = row.original.tags ?? [];
          if (!tags.length)
            return <span className="text-muted-foreground">—</span>;
          return (
            <div className="flex max-w-56 flex-wrap gap-1">
              {tags.slice(0, 3).map((tag) => (
                <Badge key={tag} variant="secondary">
                  {tag}
                </Badge>
              ))}
              {tags.length > 3 ? (
                <span className="text-[11px] tabular-nums text-muted-foreground">
                  +{tags.length - 3}
                </span>
              ) : null}
            </div>
          );
        },
      },
      {
        accessorKey: "isActive",
        header: "Status",
        cell: ({ row }) =>
          row.original.isActive ? (
            <Badge variant="good">Published</Badge>
          ) : (
            <Badge variant="outline">Draft</Badge>
          ),
      },
      {
        accessorKey: "timeToRead",
        meta: { className: "hidden md:table-cell" },
        header: ({ column }) => <SortHeader label="Read" column={column} />,
        cell: ({ row }) => (
          <span className="tabular-nums text-muted-foreground">
            {row.original.timeToRead}m
          </span>
        ),
      },
      {
        accessorKey: "createdAt",
        meta: { className: "hidden md:table-cell" },
        header: ({ column }) => <SortHeader label="Created" column={column} />,
        cell: ({ row }) => (
          <span className="tabular-nums text-muted-foreground">
            {formatRelativeDate(row.original.createdAt)}
          </span>
        ),
      },
      {
        id: "actions",
        header: "",
        meta: { className: "w-10" },
        cell: ({ row }) => {
          const blog = row.original;
          return (
            <RowActions>
              <DropdownMenuItem onClick={() => openPost(blog)}>
                <Pencil />
                Edit
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => void handleToggleActive(blog)}>
                {blog.isActive ? <EyeOff /> : <Eye />}
                {blog.isActive ? "Unpublish" : "Publish"}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                variant="destructive"
                onClick={() => setDeleteTarget(blog)}
              >
                <Trash2 />
                Delete
              </DropdownMenuItem>
            </RowActions>
          );
        },
      },
    ],
    [handleToggleActive, openPost],
  );

  if (loading) return <BlogSkeleton />;

  return (
    <Page>
      <BlogHeader>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Refresh"
          disabled={refreshing}
          onClick={() => {
            setRefreshing(true);
            void fetchBlogs();
          }}
        >
          <RefreshCw className={cn(refreshing && "animate-spin")} />
        </Button>
        <Button size="sm" asChild>
          <Link href={routes.blog.new}>
            <Plus />
            New post
          </Link>
        </Button>
      </BlogHeader>

      <PageToolbar>
        <SearchField
          value={query}
          onChange={setQuery}
          placeholder="Search title, slug, tag"
          className="w-64"
        />
        <FilterTabs<StatusFilter>
          value={filter}
          onChange={setFilter}
          options={[
            { value: "all", label: "All", count: counts.all },
            { value: "published", label: "Published", count: counts.published },
            { value: "draft", label: "Drafts", count: counts.draft },
          ]}
        />
        <ToolbarSpacer />
      </PageToolbar>

      <PageBody width="wide">
        {blogs.length === 0 ? (
          <EmptyState
            icon={ICON}
            label="No posts"
            action={
              <Button size="sm" variant="outline" asChild>
                <Link href={routes.blog.new}>
                  <Plus />
                  New post
                </Link>
              </Button>
            }
          />
        ) : (
          <PaginatedDataTable
            columns={columns}
            data={visibleBlogs}
            emptyMessage="No matching posts"
            initialSorting={[{ id: "createdAt", desc: true }]}
            onRowClick={openPost}
          />
        )}
      </PageBody>

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
        title="Delete post?"
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
