"use client";

import {
  Calendar,
  Check,
  ChevronDown,
  Loader2,
  MessageSquare,
  Trash2,
  X,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
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
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import type { ILeanBlogComment } from "@/models/BlogComment";

interface CommentCardProps {
  comment: ILeanBlogComment;
  blogId: string;
  depth?: number;
  onRefresh: () => void;
}

function CommentCard({
  comment,
  blogId,
  depth = 0,
  onRefresh,
}: CommentCardProps) {
  const [replies, setReplies] = useState<ILeanBlogComment[]>([]);
  const [loadingReplies, setLoadingReplies] = useState(false);
  const [showReplies, setShowReplies] = useState(true);
  const [hasReplies, setHasReplies] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [localComment, setLocalComment] = useState(comment);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);

  const fetchReplies = useCallback(async () => {
    try {
      setLoadingReplies(true);
      const response = await fetch(
        `/api/blog/comments?blogId=${blogId}&parentId=${comment._id}`,
      );
      if (response.ok) {
        const data = await response.json();
        setReplies(data.comments || []);
        setHasReplies((data.comments || []).length > 0);
      }
    } catch (error) {
      console.error("Error fetching replies:", error);
    } finally {
      setLoadingReplies(false);
    }
  }, [blogId, comment._id]);

  useEffect(() => {
    fetchReplies();
  }, [fetchReplies]);

  const handleApprove = async () => {
    setActionLoading("approve");
    try {
      const response = await fetch(`/api/admin/comments/${comment._id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "approve" }),
      });

      if (!response.ok) throw new Error("Failed to approve comment");

      setLocalComment((prev) => ({ ...prev, isApproved: true }));
      toast.success("Comment approved");
    } catch (error) {
      console.error("Error approving comment:", error);
      toast.error("Failed to approve comment");
    } finally {
      setActionLoading(null);
    }
  };

  const handleReject = async () => {
    setActionLoading("reject");
    try {
      const response = await fetch(`/api/admin/comments/${comment._id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "reject" }),
      });

      if (!response.ok) throw new Error("Failed to reject comment");

      setLocalComment((prev) => ({ ...prev, isApproved: false }));
      toast.success("Comment rejected");
    } catch (error) {
      console.error("Error rejecting comment:", error);
      toast.error("Failed to reject comment");
    } finally {
      setActionLoading(null);
    }
  };

  const handleDeleteConfirm = async () => {
    setDeleteDialogOpen(false);
    setActionLoading("delete");
    try {
      const response = await fetch(`/api/admin/comments/${comment._id}`, {
        method: "DELETE",
      });

      if (!response.ok) throw new Error("Failed to delete comment");

      const data = await response.json();

      if (data.softDeleted) {
        setLocalComment((prev) => ({
          ...prev,
          isDeleted: true,
          content: "[deleted]",
          authorName: "[deleted]",
        }));
        toast.success("Comment soft deleted (has replies)");
      } else {
        toast.success("Comment deleted");
        onRefresh();
      }
    } catch (error) {
      console.error("Error deleting comment:", error);
      toast.error("Failed to delete comment");
    } finally {
      setActionLoading(null);
    }
  };

  const getInitials = (name: string) => {
    if (name === "[deleted]") return "?";
    return name
      .split(" ")
      .map((n) => n[0])
      .join("")
      .toUpperCase()
      .slice(0, 2);
  };

  const isDeleted = localComment.isDeleted;

  return (
    <>
      <div className={cn(depth > 0 && "ml-6 border-l-2 border-muted pl-4")}>
        <Card className="p-4">
          <div className="flex gap-3">
            <Avatar className="w-8 h-8 shrink-0">
              <AvatarFallback
                className={cn(
                  "text-xs",
                  isDeleted
                    ? "bg-muted text-muted-foreground"
                    : "bg-primary/10 text-primary",
                )}
              >
                {getInitials(localComment.authorName)}
              </AvatarFallback>
            </Avatar>

            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap mb-1">
                <span
                  className={cn(
                    "font-medium text-sm",
                    isDeleted && "text-muted-foreground italic",
                  )}
                >
                  {localComment.authorName}
                </span>
                <Badge
                  variant={localComment.isApproved ? "default" : "secondary"}
                >
                  {localComment.isApproved ? "Approved" : "Pending"}
                </Badge>
                <span className="text-xs text-muted-foreground flex items-center gap-1">
                  <Calendar className="w-3 h-3" />
                  {new Date(localComment.createdAt).toLocaleDateString(
                    "en-US",
                    {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                    },
                  )}
                </span>
              </div>

              <p
                className={cn(
                  "text-sm whitespace-pre-wrap mb-3",
                  isDeleted
                    ? "text-muted-foreground italic"
                    : "text-foreground/90",
                )}
              >
                {localComment.content}
              </p>

              <div className="flex items-center gap-2 flex-wrap">
                {!isDeleted && (
                  <>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleApprove}
                      disabled={
                        localComment.isApproved || actionLoading !== null
                      }
                    >
                      {actionLoading === "approve" ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Check className="w-3.5 h-3.5" />
                      )}
                      Approve
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleReject}
                      disabled={
                        !localComment.isApproved || actionLoading !== null
                      }
                    >
                      {actionLoading === "reject" ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <X className="w-3.5 h-3.5" />
                      )}
                      Reject
                    </Button>
                  </>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setDeleteDialogOpen(true)}
                  disabled={actionLoading !== null}
                  className="text-destructive hover:text-destructive"
                >
                  {actionLoading === "delete" ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Trash2 className="w-3.5 h-3.5" />
                  )}
                  Delete
                </Button>
              </div>
            </div>
          </div>
        </Card>

        {hasReplies && (
          <div className="mt-2">
            <Button
              variant="ghost"
              size="sm"
              className="gap-1 text-xs"
              onClick={() => setShowReplies(!showReplies)}
            >
              <ChevronDown
                className={cn(
                  "w-3.5 h-3.5 transition-transform",
                  showReplies && "rotate-180",
                )}
              />
              {showReplies ? "Hide" : "Show"} {replies.length}{" "}
              {replies.length === 1 ? "reply" : "replies"}
            </Button>

            {showReplies && (
              <div className="mt-2 space-y-2">
                {loadingReplies ? (
                  <div className="ml-6 pl-4 border-l-2 border-muted">
                    <Skeleton className="h-24 w-full" />
                  </div>
                ) : (
                  replies.map((reply) => (
                    <CommentCard
                      key={reply._id}
                      comment={reply}
                      blogId={blogId}
                      depth={depth + 1}
                      onRefresh={fetchReplies}
                    />
                  ))
                )}
              </div>
            )}
          </div>
        )}
      </div>

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

interface CommentsListProps {
  blogId: string;
}

export function CommentsList({ blogId }: CommentsListProps) {
  const [comments, setComments] = useState<ILeanBlogComment[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchComments = useCallback(async () => {
    try {
      setLoading(true);
      const response = await fetch(`/api/blog/comments?blogId=${blogId}`);
      if (response.ok) {
        const data = await response.json();
        setComments(data.comments || []);
      }
    } catch (error) {
      console.error("Error fetching comments:", error);
    } finally {
      setLoading(false);
    }
  }, [blogId]);

  useEffect(() => {
    fetchComments();
  }, [fetchComments]);

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  if (comments.length === 0) {
    return (
      <Empty>
        <EmptyHeader className="max-w-lg!">
          <EmptyMedia variant="icon">
            <MessageSquare className="w-12 h-12 text-muted-foreground" />
          </EmptyMedia>
          <EmptyTitle>No comments yet</EmptyTitle>
          <EmptyDescription>
            There are no comments yet, make sure your blog post is visible and
            engaging.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  const pendingCount = comments.filter(
    (c) => !c.isApproved && !c.isDeleted,
  ).length;
  const approvedCount = comments.filter(
    (c) => c.isApproved && !c.isDeleted,
  ).length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3 items-center">
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-muted/50">
          <MessageSquare className="w-4 h-4 text-muted-foreground" />
          <span className="text-sm font-medium">{comments.length}</span>
          <span className="text-xs text-muted-foreground">Total</span>
        </div>
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-muted/50">
          <span className="text-sm font-medium">{pendingCount}</span>
          <span className="text-xs text-muted-foreground">Pending</span>
        </div>
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-muted/50">
          <span className="text-sm font-medium">{approvedCount}</span>
          <span className="text-xs text-muted-foreground">Approved</span>
        </div>
      </div>

      <div className="space-y-3">
        {comments.map((comment) => (
          <CommentCard
            key={comment._id}
            comment={comment}
            blogId={blogId}
            onRefresh={fetchComments}
          />
        ))}
      </div>
    </div>
  );
}
