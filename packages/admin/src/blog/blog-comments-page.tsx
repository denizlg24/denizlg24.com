"use client";

import type { IBlogComment } from "@repo/schemas";
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
import { Check, MessageCircle, RefreshCw, Trash2, X } from "lucide-react";
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
type CommentState = Exclude<CommentFilter, "all">;

const ICON = <MessageCircle />;

function commentState(comment: CommentWithBlogTitle): CommentState {
  if (comment.isDeleted) return "deleted";
  return comment.isApproved ? "approved" : "pending";
}

const STATE_BADGE: Record<
  CommentState,
  { label: string; variant: "warning" | "good" | "critical" }
> = {
  pending: { label: "Pending", variant: "warning" },
  approved: { label: "Approved", variant: "good" },
  deleted: { label: "Deleted", variant: "critical" },
};

function CommentsHeader({ children }: { children?: ReactNode }) {
  const { slots } = useAdmin();
  return (
    <PageHeader leading={slots?.sidebarTrigger} icon={ICON} title="Comments">
      {children}
    </PageHeader>
  );
}

export function BlogCommentsSkeleton() {
  return (
    <Page>
      <CommentsHeader />
      <PageToolbar>
        <Skeleton className="h-7 w-56" />
        <Skeleton className="h-5 w-64" />
      </PageToolbar>
      <PageBody width="wide">
        <TableSkeleton
          rows={8}
          widths={["w-24", "w-32", "flex-1", "w-16", "w-16", "w-8"]}
        />
      </PageBody>
    </Page>
  );
}

function matchesQuery(comment: CommentWithBlogTitle, query: string): boolean {
  if (!query) return true;
  const needle = query.toLowerCase();
  return (
    comment.authorName.toLowerCase().includes(needle) ||
    comment.content.toLowerCase().includes(needle) ||
    (comment.blogTitle ?? "").toLowerCase().includes(needle)
  );
}

export function BlogCommentsPage() {
  const { client } = useAdmin();

  const [comments, setComments] = useState<CommentWithBlogTitle[]>([]);
  const [stats, setStats] = useState<CommentStats>({
    total: 0,
    pending: 0,
    approved: 0,
    deleted: 0,
  });
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState<CommentFilter>("all");
  const [query, setQuery] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<CommentWithBlogTitle | null>(
    null,
  );

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
      setRefreshing(false);
    }
  }, [client]);

  useEffect(() => {
    void fetchComments();
  }, [fetchComments]);

  const visibleComments = useMemo(
    () =>
      comments.filter(
        (comment) =>
          (filter === "all" || commentState(comment) === filter) &&
          matchesQuery(comment, query.trim()),
      ),
    [comments, filter, query],
  );

  const setApproval = useCallback(
    async (comment: CommentWithBlogTitle, approve: boolean) => {
      if (comment.isApproved === approve) return;
      const from: CommentState = approve ? "pending" : "approved";
      const to: CommentState = approve ? "approved" : "pending";
      const move = (a: CommentState, b: CommentState) =>
        setStats((prev) => ({ ...prev, [a]: prev[a] - 1, [b]: prev[b] + 1 }));

      setComments((prev) =>
        prev.map((c) =>
          c._id === comment._id ? { ...c, isApproved: approve } : c,
        ),
      );
      move(from, to);

      try {
        await client.patch<{ success: boolean }>(`comments/${comment._id}`, {
          action: approve ? "approve" : "reject",
        });
      } catch {
        toast.error(
          approve ? "Failed to approve comment" : "Failed to reject comment",
        );
        setComments((prev) =>
          prev.map((c) =>
            c._id === comment._id
              ? { ...c, isApproved: comment.isApproved }
              : c,
          ),
        );
        move(to, from);
      }
    },
    [client],
  );

  const handleDelete = async () => {
    const target = deleteTarget;
    if (!target) return;
    setDeleteTarget(null);
    try {
      const result = await client.del<{
        success: boolean;
        softDeleted?: boolean;
      }>(`comments/${target._id}`);
      const previous = commentState(target);
      // A comment with replies is only marked deleted; one without is gone.
      if (result.softDeleted) {
        setComments((prev) =>
          prev.map((c) =>
            c._id === target._id ? { ...c, isDeleted: true } : c,
          ),
        );
        setStats((prev) => ({
          ...prev,
          [previous]: prev[previous] - 1,
          deleted: prev.deleted + 1,
        }));
      } else {
        setComments((prev) => prev.filter((c) => c._id !== target._id));
        setStats((prev) => ({
          ...prev,
          [previous]: prev[previous] - 1,
          total: prev.total - 1,
        }));
      }
      toast.success("Comment deleted");
    } catch {
      toast.error("Failed to delete comment");
    }
  };

  const columns = useMemo<ColumnDef<CommentWithBlogTitle, unknown>[]>(
    () => [
      {
        accessorKey: "authorName",
        header: ({ column }) => <SortHeader label="Author" column={column} />,
        cell: ({ row }) => (
          <span className="text-accent-strong">{row.original.authorName}</span>
        ),
      },
      {
        accessorKey: "content",
        header: "Comment",
        enableSorting: false,
        cell: ({ row }) => (
          <div className="flex min-w-0 flex-col">
            <span className="block max-w-[32rem] truncate">
              {row.original.content}
            </span>
            {row.original.blogTitle ? (
              <span className="block max-w-[32rem] truncate text-[11px] text-muted-foreground">
                {row.original.blogTitle}
              </span>
            ) : null}
          </div>
        ),
      },
      {
        id: "status",
        header: "Status",
        accessorFn: commentState,
        cell: ({ row }) => {
          const badge = STATE_BADGE[commentState(row.original)];
          return <Badge variant={badge.variant}>{badge.label}</Badge>;
        },
      },
      {
        accessorKey: "createdAt",
        meta: { className: "hidden md:table-cell" },
        header: ({ column }) => <SortHeader label="Date" column={column} />,
        cell: ({ row }) => (
          <span className="tabular-nums text-muted-foreground">
            {formatRelativeDate(row.original.createdAt)}
          </span>
        ),
      },
      {
        id: "actions",
        header: "",
        meta: { className: "w-20" },
        cell: ({ row }) => {
          const comment = row.original;
          if (comment.isDeleted) return null;
          return (
            <div className="flex items-center justify-end gap-0.5">
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={comment.isApproved ? "Reject" : "Approve"}
                className="text-muted-foreground"
                onClick={() => void setApproval(comment, !comment.isApproved)}
              >
                {comment.isApproved ? <X /> : <Check />}
              </Button>
              <RowActions>
                <DropdownMenuItem
                  onClick={() => void setApproval(comment, !comment.isApproved)}
                >
                  {comment.isApproved ? <X /> : <Check />}
                  {comment.isApproved ? "Reject" : "Approve"}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  variant="destructive"
                  onClick={() => setDeleteTarget(comment)}
                >
                  <Trash2 />
                  Delete
                </DropdownMenuItem>
              </RowActions>
            </div>
          );
        },
      },
    ],
    [setApproval],
  );

  if (loading) return <BlogCommentsSkeleton />;

  return (
    <Page>
      <CommentsHeader>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Refresh"
          disabled={refreshing}
          onClick={() => {
            setRefreshing(true);
            void fetchComments();
          }}
        >
          <RefreshCw className={cn(refreshing && "animate-spin")} />
        </Button>
      </CommentsHeader>

      <PageToolbar>
        <SearchField
          value={query}
          onChange={setQuery}
          placeholder="Search author, comment, post"
          className="w-64"
        />
        <FilterTabs<CommentFilter>
          value={filter}
          onChange={setFilter}
          options={[
            { value: "all", label: "All", count: stats.total },
            { value: "pending", label: "Pending", count: stats.pending },
            { value: "approved", label: "Approved", count: stats.approved },
            { value: "deleted", label: "Deleted", count: stats.deleted },
          ]}
        />
        <ToolbarSpacer />
      </PageToolbar>

      <PageBody width="wide">
        {comments.length === 0 ? (
          <EmptyState icon={ICON} label="No comments" />
        ) : (
          <PaginatedDataTable
            columns={columns}
            data={visibleComments}
            emptyMessage="No matching comments"
            initialSorting={[{ id: "createdAt", desc: true }]}
          />
        )}
      </PageBody>

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
        title="Delete comment?"
        description={
          deleteTarget ? `Comment by ${deleteTarget.authorName}.` : undefined
        }
        actionLabel="Delete"
        destructive
        onConfirm={handleDelete}
      />
    </Page>
  );
}
