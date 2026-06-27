"use client";

import type { IBlogComment } from "@repo/schemas";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@repo/ui/alert-dialog";
import { Badge } from "@repo/ui/badge";
import { Button } from "@repo/ui/button";
import { SortHeader } from "@repo/ui/data-table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@repo/ui/dropdown-menu";
import { PageHeader } from "@repo/ui/page-header";
import { PaginatedDataTable } from "@repo/ui/paginated-data-table";
import { Separator } from "@repo/ui/separator";
import { Skeleton } from "@repo/ui/skeleton";
import { TableSkeleton, TabStripSkeleton } from "@repo/ui/skeleton-blocks";
import { Tabs, TabsList, TabsTrigger } from "@repo/ui/tabs";
import type { ColumnDef } from "@tanstack/react-table";
import {
  Check,
  MessageCircle,
  MoreHorizontal,
  RefreshCw,
  Trash2,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { useAdmin } from "../provider";

interface CommentWithBlogTitle extends IBlogComment {
  blogTitle?: string;
}

interface CommentStats {
  total: number;
  pending: number;
  approved: number;
  deleted: number;
}

type CommentFilter = "all" | "pending" | "approved" | "deleted";

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

export function BlogCommentsSkeleton() {
  const { slots } = useAdmin();
  return (
    <div className="flex flex-col gap-2 pb-8">
      <PageHeader
        leading={slots?.sidebarTrigger}
        icon={<MessageCircle className="size-4 text-muted-foreground" />}
        title="Comments"
      />
      <div className="px-4 flex flex-col gap-6 pt-3">
        <div className="flex items-baseline gap-8">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="flex flex-col gap-1">
              <Skeleton className="h-3 w-14" />
              <Skeleton className="h-6 w-8" />
            </div>
          ))}
        </div>
        <TabStripSkeleton widths={["w-10", "w-16", "w-20", "w-16"]} />
        <TableSkeleton
          rows={6}
          widths={["w-24", "w-32", "flex-1", "w-16", "w-16", "w-8"]}
        />
      </div>
    </div>
  );
}

export function BlogCommentsPage() {
  const { client, slots } = useAdmin();

  const [comments, setComments] = useState<CommentWithBlogTitle[]>([]);
  const [stats, setStats] = useState<CommentStats>({
    total: 0,
    pending: 0,
    approved: 0,
    deleted: 0,
  });
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<CommentFilter>("all");
  const [deleteTarget, setDeleteTarget] = useState<CommentWithBlogTitle | null>(
    null,
  );
  const [deleting, setDeleting] = useState(false);

  const fetchComments = useCallback(async () => {
    try {
      const result = await client.get<{
        comments: CommentWithBlogTitle[];
        stats: CommentStats;
      }>("comments");
      setComments(result.comments);
      setStats(result.stats);
    } catch {
      toast.error("Failed to load comments");
    } finally {
      setLoading(false);
    }
  }, [client]);

  useEffect(() => {
    fetchComments();
  }, [fetchComments]);

  const filteredComments = useMemo(() => {
    if (filter === "all") return comments;
    if (filter === "pending")
      return comments.filter((c) => !c.isApproved && !c.isDeleted);
    if (filter === "approved")
      return comments.filter((c) => c.isApproved && !c.isDeleted);
    return comments.filter((c) => c.isDeleted);
  }, [comments, filter]);

  const handleApprove = async (
    e: React.MouseEvent,
    comment: CommentWithBlogTitle,
  ) => {
    e.stopPropagation();

    setComments((prev) =>
      prev.map((c) => (c._id === comment._id ? { ...c, isApproved: true } : c)),
    );
    setStats((prev) => ({
      ...prev,
      pending: prev.pending - 1,
      approved: prev.approved + 1,
    }));

    try {
      await client.patch<{ success: boolean }>(`comments/${comment._id}`, {
        action: "approve",
      });
    } catch {
      toast.error("Failed to approve comment");
      setComments((prev) =>
        prev.map((c) =>
          c._id === comment._id ? { ...c, isApproved: comment.isApproved } : c,
        ),
      );
      setStats((prev) => ({
        ...prev,
        pending: prev.pending + 1,
        approved: prev.approved - 1,
      }));
    }
  };

  const handleReject = async (
    e: React.MouseEvent,
    comment: CommentWithBlogTitle,
  ) => {
    e.stopPropagation();

    setComments((prev) =>
      prev.map((c) =>
        c._id === comment._id ? { ...c, isApproved: false } : c,
      ),
    );
    setStats((prev) => ({
      ...prev,
      approved: prev.approved - 1,
      pending: prev.pending + 1,
    }));

    try {
      await client.patch<{ success: boolean }>(`comments/${comment._id}`, {
        action: "reject",
      });
    } catch {
      toast.error("Failed to reject comment");
      setComments((prev) =>
        prev.map((c) =>
          c._id === comment._id ? { ...c, isApproved: comment.isApproved } : c,
        ),
      );
      setStats((prev) => ({
        ...prev,
        approved: prev.approved + 1,
        pending: prev.pending - 1,
      }));
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);

    try {
      await client.del<{ success: boolean }>(`comments/${deleteTarget._id}`);
      setComments((prev) =>
        prev.map((c) =>
          c._id === deleteTarget._id ? { ...c, isDeleted: true } : c,
        ),
      );
      setStats((prev) => {
        const wasPending = !deleteTarget.isApproved && !deleteTarget.isDeleted;
        const wasApproved = deleteTarget.isApproved && !deleteTarget.isDeleted;
        return {
          ...prev,
          pending: wasPending ? prev.pending - 1 : prev.pending,
          approved: wasApproved ? prev.approved - 1 : prev.approved,
          deleted: prev.deleted + 1,
        };
      });
      toast.success("Comment deleted");
    } catch {
      toast.error("Failed to delete comment");
    }
    setDeleting(false);
    setDeleteTarget(null);
  };

  const getCommentStatus = (
    comment: CommentWithBlogTitle,
  ): {
    label: string;
    variant: "outline" | "secondary" | "default" | "destructive";
  } => {
    if (comment.isDeleted) return { label: "Deleted", variant: "destructive" };
    if (comment.isApproved) return { label: "Approved", variant: "default" };
    return { label: "Pending", variant: "outline" };
  };

  const columns: ColumnDef<CommentWithBlogTitle, unknown>[] = [
    {
      accessorKey: "authorName",
      header: "Author",
      cell: ({ row }) => (
        <span className="font-medium">{row.getValue("authorName")}</span>
      ),
    },
    {
      accessorKey: "blogTitle",
      meta: { className: "hidden md:table-cell" },
      header: "Post",
      cell: ({ row }) => (
        <span className="text-muted-foreground truncate block max-w-[150px]">
          {row.original.blogTitle ?? "-"}
        </span>
      ),
    },
    {
      accessorKey: "content",
      meta: { className: "hidden lg:table-cell" },
      header: "Content",
      cell: ({ row }) => (
        <span className="text-muted-foreground truncate block max-w-[250px]">
          {row.getValue("content")}
        </span>
      ),
    },
    {
      id: "status",
      header: "Status",
      cell: ({ row }) => {
        const status = getCommentStatus(row.original);
        return (
          <Badge variant={status.variant} className="text-[10px]">
            {status.label}
          </Badge>
        );
      },
    },
    {
      accessorKey: "createdAt",
      meta: { className: "hidden md:table-cell" },
      header: ({ column }) => <SortHeader label="Date" column={column} />,
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
        const comment = row.original;
        if (comment.isDeleted) return null;

        return (
          <div className="flex items-center gap-1">
            {!comment.isApproved && (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 w-7 p-0 text-green-600 hover:text-green-700"
                onClick={(e) => handleApprove(e, comment)}
                title="Approve"
              >
                <Check className="size-3.5" />
              </Button>
            )}
            {comment.isApproved && (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 w-7 p-0 text-orange-500 hover:text-orange-600"
                onClick={(e) => handleReject(e, comment)}
                title="Reject"
              >
                <X className="size-3.5" />
              </Button>
            )}
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
                {!comment.isApproved ? (
                  <DropdownMenuItem onClick={(e) => handleApprove(e, comment)}>
                    <Check className="size-3.5" />
                    Approve
                  </DropdownMenuItem>
                ) : (
                  <DropdownMenuItem onClick={(e) => handleReject(e, comment)}>
                    <X className="size-3.5" />
                    Reject
                  </DropdownMenuItem>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  className="text-destructive focus:text-destructive"
                  onClick={(e) => {
                    e.stopPropagation();
                    setDeleteTarget(comment);
                  }}
                >
                  <Trash2 className="size-3.5" />
                  Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        );
      },
    },
  ];

  if (loading) {
    return <BlogCommentsSkeleton />;
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-2 overflow-hidden">
      <PageHeader
        leading={slots?.sidebarTrigger}
        icon={<MessageCircle className="size-4 text-muted-foreground" />}
        title="Comments"
      >
        <Button
          variant="ghost"
          size="sm"
          className="h-8 text-xs gap-1.5"
          onClick={() => {
            setLoading(true);
            fetchComments();
          }}
        >
          <RefreshCw className={`size-3.5 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </PageHeader>

      <div className="px-4 flex flex-1 min-h-0 flex-col gap-4 overflow-hidden pt-3 pb-8">
        <div className="flex items-baseline gap-8 flex-wrap">
          <Stat label="Total" value={stats.total} />
          <Stat
            label="Pending"
            value={stats.pending}
            highlight={stats.pending > 0}
          />
          <Stat label="Approved" value={stats.approved} />
          <Stat label="Deleted" value={stats.deleted} />
        </div>

        <Separator />

        <Tabs
          value={filter}
          onValueChange={(v) => setFilter(v as CommentFilter)}
        >
          <TabsList variant="line">
            <TabsTrigger value="all">
              All
              <span className="ml-1 text-[10px] text-muted-foreground tabular-nums">
                {stats.total}
              </span>
            </TabsTrigger>
            <TabsTrigger value="pending">
              Pending
              <span className="ml-1 text-[10px] text-muted-foreground tabular-nums">
                {stats.pending}
              </span>
            </TabsTrigger>
            <TabsTrigger value="approved">
              Approved
              <span className="ml-1 text-[10px] text-muted-foreground tabular-nums">
                {stats.approved}
              </span>
            </TabsTrigger>
            <TabsTrigger value="deleted">
              Deleted
              <span className="ml-1 text-[10px] text-muted-foreground tabular-nums">
                {stats.deleted}
              </span>
            </TabsTrigger>
          </TabsList>
        </Tabs>

        <div className="min-h-0 flex-1">
          <PaginatedDataTable
            columns={columns}
            data={filteredComments}
            emptyMessage="No comments found"
            initialSorting={[{ id: "createdAt", desc: true }]}
            searchPlaceholder="Search author, content..."
          />
        </div>
      </div>

      <AlertDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
      >
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete comment?</AlertDialogTitle>
            <AlertDialogDescription>
              This will delete the comment by &ldquo;{deleteTarget?.authorName}
              &rdquo;. Comments with replies will be soft-deleted.
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
