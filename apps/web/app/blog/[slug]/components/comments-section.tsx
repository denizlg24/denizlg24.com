"use client";

import { MessageSquare } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type { ILeanBlogComment } from "@/models/BlogComment";
import { CommentCard } from "./comment-card";
import { CommentInput, getCommenterInfo } from "./comment-input";

interface CommentsSectionProps {
  blogId: string;
}

export function CommentsSection({ blogId }: CommentsSectionProps) {
  const [comments, setComments] = useState<ILeanBlogComment[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchComments = useCallback(async () => {
    try {
      setLoading(true);
      const commenterInfo = getCommenterInfo();
      const sessionParam = commenterInfo?.sessionId
        ? `&sessionId=${commenterInfo.sessionId}`
        : "";
      const response = await fetch(
        `/api/blog/comments?blogId=${blogId}${sessionParam}`,
      );
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

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <MessageSquare className="w-5 h-5" />
        <h2 className="text-lg font-semibold">Comments</h2>
        {!loading && comments.length > 0 && (
          <span className="text-sm text-muted-foreground">
            ({comments.length})
          </span>
        )}
      </div>

      <CommentInput blogId={blogId} onCommentSubmitted={fetchComments} />

      {loading ? (
        <div className="text-sm text-muted-foreground">Loading comments...</div>
      ) : comments.length === 0 ? (
        <div className="text-sm text-muted-foreground py-8 text-center">
          No comments yet. Be the first to share your thoughts!
        </div>
      ) : (
        <div className="space-y-6 pt-4">
          {comments.map((comment) => (
            <CommentCard
              key={comment._id}
              comment={comment}
              blogId={blogId}
              onDeleted={fetchComments}
            />
          ))}
        </div>
      )}
    </div>
  );
}
