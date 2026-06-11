"use client";

import type { ColumnDef } from "@tanstack/react-table";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Check,
  MessageCircle,
  MoreHorizontal,
  RefreshCw,
  Trash2,
  X,
} from "lucide-react";
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
import type { IBlogComment } from "@/lib/data-types";

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

function CommentsLoadingSkeleton() {
  return (
    <div className="flex flex-col gap-2 pb-8">
      <div className="flex items-center gap-2 px-4 border-b h-12 shrink-0">
        <MessageCircle className="size-4 text-muted-foreground" />
        <span className="text-sm font-semibold flex-1">Comments</span>
      </div>
      <div className="px-4 flex flex-col gap-6 pt-3">
        <div className="flex items-baseline gap-8">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="flex flex-col gap-1">
              <Skeleton className="h-3 w-14" />
              <Skeleton className="h-6 w-8" />
            </div>
          ))}
        </div>
        <Skeleton className="h-9 w-72 rounded-lg" />
        <div className="flex flex-col">
          <Skeleton className="h-10 w-full" />
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="flex items-center gap-3 py-3 border-b">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-4 w-48 flex-1" />
              <Skeleton className="h-5 w-16 rounded-full" />
              <Skeleton className="h-4 w-16" />
              <Skeleton className="h-6 w-6 rounded" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function CommentsPage() {
  const { settings, loading: loadingSettings } = useUserSettings();

  const api = useMemo(() => {
    if (loadingSettings) return null;
    return new denizApi(settings.apiKey);
  }, [settings, loadingSettings]);

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
    if (!api) return;
    const result = await api.GET<{
      comments: CommentWithBlogTitle[];
      stats: CommentStats;
    }>({
      endpoint: "comments",
    });
    if (!("code" in result)) {
      setComments(result.comments);
      setStats(result.stats);
    } else {
      toast.error("Failed to load comments");
    }
    setLoading(false);
  }, [api]);

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
    if (!api) return;

    setComments((prev) =>
      prev.map((c) => (c._id === comment._id ? { ...c, isApproved: true } : c)),
    );
    setStats((prev) => ({
      ...prev,
      pending: prev.pending - 1,
      approved: prev.approved + 1,
    }));

    const result = await api.PATCH<{ success: boolean }>({
      endpoint: `comments/${comment._id}`,
      body: { action: "approve" },
    });

    if ("code" in result) {
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
    if (!api) return;

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

    const result = await api.PATCH<{ success: boolean }>({
      endpoint: `comments/${comment._id}`,
      body: { action: "reject" },
    });

    if ("code" in result) {
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
    if (!deleteTarget || !api) return;
    setDeleting(true);

    const result = await api.DELETE<{ success: boolean }>({
      endpoint: `comments/${deleteTarget._id}`,
    });

    if ("code" in result) {
      toast.error("Failed to delete comment");
    } else {
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
      header: "Post",
      cell: ({ row }) => (
        <span className="text-muted-foreground truncate block max-w-[150px]">
          {row.original.blogTitle ?? "-"}
        </span>
      ),
    },
    {
      accessorKey: "content",
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

  if (loadingSettings || loading) {
    return <CommentsLoadingSkeleton />;
  }

  if (!api) {
    return (
      <div className="flex flex-col gap-2 pb-8">
        <div className="flex items-center gap-2 px-4 border-b h-12 shrink-0">
          <MessageCircle className="size-4 text-muted-foreground" />
          <span className="text-sm font-semibold flex-1">Comments</span>
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
        <MessageCircle className="size-4 text-muted-foreground" />
        <span className="text-sm font-semibold flex-1">Comments</span>
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
      </div>

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
