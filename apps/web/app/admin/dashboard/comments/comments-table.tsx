"use client";

import type { ColumnDef } from "@tanstack/react-table";
import {
  ArrowUpDown,
  Check,
  ExternalLink,
  MoreHorizontal,
  Trash2,
  X,
} from "lucide-react";
import Link from "next/link";
import { useState } from "react";
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
import { DataTable } from "@/components/ui/data-table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { CommentWithBlogTitle } from "@/lib/comments";

interface CommentsTableProps {
  initialComments: CommentWithBlogTitle[];
  onApprovalChange?: (wasApproved: boolean, isNowApproved: boolean) => void;
  onDelete?: (wasApproved: boolean) => void;
  children?: React.ReactNode;
}

export function CommentsTable({
  initialComments,
  onApprovalChange,
  onDelete,
  children,
}: CommentsTableProps) {
  const [localUpdates, setLocalUpdates] = useState<
    Map<string, { isApproved?: boolean; isDeleted?: boolean }>
  >(new Map());
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [commentToDelete, setCommentToDelete] = useState<string | null>(null);

  const comments = initialComments
    .map((comment) => {
      const update = localUpdates.get(comment._id);
      if (update) {
        return { ...comment, ...update };
      }
      return comment;
    })
    .filter((comment) => !localUpdates.get(comment._id)?.isDeleted);

  const handleApprove = async (id: string) => {
    const comment = comments.find((c) => c._id === id);
    if (!comment) return;

    const wasApproved = comment.isApproved;

    try {
      const response = await fetch(`/api/admin/comments/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "approve" }),
      });

      if (!response.ok) throw new Error("Failed to approve comment");

      setLocalUpdates((prev) => {
        const next = new Map(prev);
        next.set(id, { ...next.get(id), isApproved: true });
        return next;
      });

      onApprovalChange?.(wasApproved, true);
      toast.success("Comment approved");
    } catch (error) {
      console.error("Error approving comment:", error);
      toast.error("Failed to approve comment");
    }
  };

  const handleReject = async (id: string) => {
    const comment = comments.find((c) => c._id === id);
    if (!comment) return;

    const wasApproved = comment.isApproved;

    try {
      const response = await fetch(`/api/admin/comments/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "reject" }),
      });

      if (!response.ok) throw new Error("Failed to reject comment");

      setLocalUpdates((prev) => {
        const next = new Map(prev);
        next.set(id, { ...next.get(id), isApproved: false });
        return next;
      });

      onApprovalChange?.(wasApproved, false);
      toast.success("Comment rejected");
    } catch (error) {
      console.error("Error rejecting comment:", error);
      toast.error("Failed to reject comment");
    }
  };

  const handleDeleteClick = (id: string) => {
    setCommentToDelete(id);
    setDeleteDialogOpen(true);
  };

  const handleDeleteConfirm = async () => {
    if (!commentToDelete) return;

    const comment = comments.find((c) => c._id === commentToDelete);
    if (!comment) {
      setDeleteDialogOpen(false);
      setCommentToDelete(null);
      return;
    }

    try {
      const response = await fetch(`/api/admin/comments/${commentToDelete}`, {
        method: "DELETE",
      });

      if (!response.ok) throw new Error("Failed to delete comment");

      const data = await response.json();

      setLocalUpdates((prev) => {
        const next = new Map(prev);
        next.set(commentToDelete, {
          ...next.get(commentToDelete),
          isDeleted: true,
        });
        return next;
      });
      onDelete?.(comment.isApproved);

      toast.success(
        data.softDeleted
          ? "Comment soft deleted (has replies)"
          : "Comment deleted",
      );
    } catch (error) {
      console.error("Error deleting comment:", error);
      toast.error("Failed to delete comment");
    } finally {
      setDeleteDialogOpen(false);
      setCommentToDelete(null);
    }
  };

  const columns: ColumnDef<CommentWithBlogTitle>[] = [
    {
      accessorKey: "authorName",
      header: ({ column }) => (
        <Button
          variant="ghost"
          onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
        >
          Author
          <ArrowUpDown className="ml-2 h-4 w-4" />
        </Button>
      ),
      cell: ({ row }) => (
        <span className="font-medium">{row.getValue("authorName")}</span>
      ),
    },
    {
      accessorKey: "content",
      header: "Comment",
      cell: ({ row }) => (
        <div className="max-w-xs truncate text-sm text-muted-foreground">
          {row.getValue("content")}
        </div>
      ),
    },
    {
      accessorKey: "blogTitle",
      header: "Blog Post",
      cell: ({ row }) => {
        const comment = row.original;
        return comment.blogSlug ? (
          <Link
            href={`/blog/${comment.blogSlug}`}
            target="_blank"
            className="text-sm hover:underline inline-flex items-center gap-1"
          >
            {comment.blogTitle || "Unknown"}
            <ExternalLink className="w-3 h-3" />
          </Link>
        ) : (
          <span className="text-sm text-muted-foreground">
            {comment.blogTitle || "Unknown"}
          </span>
        );
      },
    },
    {
      accessorKey: "isApproved",
      header: "Status",
      cell: ({ row }) => {
        const isApproved = row.getValue("isApproved") as boolean;
        return (
          <Badge variant={isApproved ? "default" : "secondary"}>
            {isApproved ? "Approved" : "Pending"}
          </Badge>
        );
      },
    },
    {
      accessorKey: "createdAt",
      header: ({ column }) => (
        <Button
          variant="ghost"
          onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
        >
          Date
          <ArrowUpDown className="ml-2 h-4 w-4" />
        </Button>
      ),
      cell: ({ row }) => {
        const date = new Date(row.getValue("createdAt"));
        return (
          <div className="text-sm">
            {date.toLocaleDateString("en-US", {
              month: "short",
              day: "numeric",
              year: "numeric",
            })}
          </div>
        );
      },
    },
    {
      id: "actions",
      cell: ({ row }) => {
        const comment = row.original;
        return (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm">
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>Actions</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => handleApprove(comment._id)}
                disabled={comment.isApproved}
              >
                <Check className="mr-2 h-4 w-4" />
                Approve
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => handleReject(comment._id)}
                disabled={!comment.isApproved}
              >
                <X className="mr-2 h-4 w-4" />
                Reject
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => handleDeleteClick(comment._id)}
                className="text-destructive focus:text-destructive"
              >
                <Trash2 className="mr-2 h-4 w-4" />
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        );
      },
    },
  ];

  return (
    <>
      <DataTable
        columns={columns}
        data={comments}
        children={children}
        searchPlaceholder="Search by author or blog title..."
        searchableColumns={["authorName", "blogTitle", "content"]}
      />

      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Comment</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this comment? This action cannot
              be undone. If the comment has replies, it will be soft deleted
              instead.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteConfirm}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
