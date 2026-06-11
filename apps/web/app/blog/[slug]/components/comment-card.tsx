"use client";

import Cookies from "js-cookie";
import {
  Calendar,
  ChevronUp,
  Clock,
  Loader2Icon,
  MessageSquare,
  Trash2,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth-client";
import { cn } from "@/lib/utils";
import type { ILeanBlogComment } from "@/models/BlogComment";
import { CommentInput, getCommenterInfo } from "./comment-input";

const COMMENTER_COOKIE = "blog_commenter";

interface CommentCardProps {
  comment: ILeanBlogComment;
  blogId: string;
  depth?: number;
  onDeleted?: () => void;
}

export function CommentCard({
  comment,
  blogId,
  depth = 0,
  onDeleted,
}: CommentCardProps) {
  const [showReplyInput, setShowReplyInput] = useState(false);
  const [replies, setReplies] = useState<ILeanBlogComment[]>([]);
  const [loadingReplies, setLoadingReplies] = useState(false);
  const [showReplies, setShowReplies] = useState(true);
  const [hasReplies, setHasReplies] = useState(false);
  const [isOwner, setIsOwner] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [localIsDeleted, setLocalIsDeleted] = useState(
    comment.isDeleted ?? false,
  );

  const { data: session } = authClient.useSession();
  const isAdmin = !!session?.user;

  const maxDepth = 3;

  const fetchReplies = useCallback(async () => {
    try {
      setLoadingReplies(true);
      const commenterInfo = getCommenterInfo();
      const sessionParam = commenterInfo?.sessionId
        ? `&sessionId=${commenterInfo.sessionId}`
        : "";
      const response = await fetch(
        `/api/blog/comments?blogId=${blogId}&parentId=${comment._id}${sessionParam}`,
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

    const cookie = Cookies.get(COMMENTER_COOKIE);
    if (cookie) {
      try {
        const info = JSON.parse(cookie);
        setIsOwner(info.name === comment.authorName);
      } catch {}
    }
  }, [comment.authorName, fetchReplies]);

  const handleCommentSubmitted = () => {
    setShowReplyInput(false);
    fetchReplies();
  };

  const handleDelete = async () => {
    if (!isAdmin || deleting) return;

    setDeleting(true);
    try {
      const response = await fetch(`/api/blog/comments/${comment._id}`, {
        method: "DELETE",
      });

      if (!response.ok) {
        throw new Error("Failed to delete comment");
      }

      const data = await response.json();

      if (data.softDeleted) {
        toast.success("Comment content deleted");
        setLocalIsDeleted(true);
      } else {
        toast.success("Comment deleted");
        onDeleted?.();
      }
    } catch (error) {
      console.error("Error deleting comment:", error);
      toast.error("Failed to delete comment");
    } finally {
      setDeleting(false);
    }
  };

  const getInitials = (name: string) => {
    if (name === "Anonymous" || name.startsWith("Anonymous ")) return "?";
    if (name === "Me") return "ME";
    return name
      .split(" ")
      .map((n) => n[0])
      .join("")
      .toUpperCase()
      .slice(0, 2);
  };

  const formatDate = (dateStr: string | Date) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  };

  const displayName = isOwner ? "Me" : comment.authorName;
  const isDeletedComment = localIsDeleted;
  const isPending = !comment.isApproved && !isDeletedComment;

  return (
    <div className={`${depth > 0 ? "ml-8 border-l-2 border-muted pl-4" : ""}`}>
      <div className="flex gap-3">
        <Avatar className="w-8 h-8 shrink-0">
          <AvatarFallback
            className={cn(
              "text-xs",
              isDeletedComment
                ? "bg-muted text-muted-foreground"
                : "bg-primary/10 text-primary",
            )}
          >
            {isDeletedComment ? "?" : getInitials(displayName)}
          </AvatarFallback>
        </Avatar>

        <div className="flex-1 space-y-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span
              className={cn(
                "font-medium text-sm",
                isDeletedComment && "text-muted-foreground italic",
              )}
            >
              {isDeletedComment ? "[deleted]" : displayName}
            </span>
            <span className="text-xs text-muted-foreground flex items-center gap-1">
              <Calendar className="w-3 h-3" />
              {formatDate(comment.createdAt)}
            </span>
            {isPending && (
              <span className="text-xs text-amber-600 dark:text-amber-500 flex items-center gap-1">
                <Clock className="w-3 h-3" />
                Pending
              </span>
            )}
          </div>

          <p
            className={cn(
              "text-sm whitespace-pre-wrap",
              isDeletedComment
                ? "text-muted-foreground italic"
                : "text-foreground/90",
            )}
          >
            {isDeletedComment
              ? "[This comment has been deleted]"
              : comment.content}
          </p>

          <div className="flex items-center gap-2 pt-1">
            {depth < maxDepth && !isDeletedComment && (
              <Button
                variant="ghost"
                size="sm"
                className="h-fit! p-0! hover:bg-transparent! hover:text-primary transition-colors rounded-none! text-xs "
                onClick={() => setShowReplyInput(!showReplyInput)}
              >
                <MessageSquare className="w-3 h-3" />
                Reply
              </Button>
            )}
            {hasReplies && (
              <Button
                variant="ghost"
                size="sm"
                className="h-fit! p-0! hover:bg-transparent! hover:text-primary transition-colors text-xs "
                onClick={() => setShowReplies(!showReplies)}
              >
                <ChevronUp
                  className={cn(
                    "w-3 h-3 transition-transform duration-200",
                    showReplies && "rotate-180",
                  )}
                />
                {showReplies ? (
                  <>Hide replies ({replies.length})</>
                ) : (
                  <>Show replies ({replies.length})</>
                )}
              </Button>
            )}

            {isAdmin &&
              (!isDeletedComment || (isDeletedComment && !hasReplies)) && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-fit! p-0! hover:bg-transparent! hover:text-destructive transition-colors text-xs text-muted-foreground"
                  onClick={handleDelete}
                  disabled={deleting}
                >
                  {deleting ? (
                    <Loader2Icon className="w-3 h-3 animate-spin" />
                  ) : (
                    <Trash2 className="w-3 h-3" />
                  )}
                </Button>
              )}
          </div>

          {showReplyInput && (
            <div className="pt-2">
              <CommentInput
                blogId={blogId}
                parentCommentId={comment._id}
                onCommentSubmitted={handleCommentSubmitted}
                placeholder={`Reply to ${displayName}...`}
                isReply
              />
            </div>
          )}
        </div>
      </div>

      {showReplies && !loadingReplies && replies.length > 0 && (
        <div className="mt-4 space-y-4">
          {replies.map((reply) => (
            <CommentCard
              key={reply._id}
              comment={reply}
              blogId={blogId}
              depth={depth + 1}
              onDeleted={fetchReplies}
            />
          ))}
        </div>
      )}

      {loadingReplies && (
        <div className="ml-8 mt-2 text-xs text-muted-foreground">
          Loading replies...
        </div>
      )}
    </div>
  );
}
