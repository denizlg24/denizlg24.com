import {
  approveComment,
  deleteComment,
  getAllComments,
  getCommentStats,
  rejectComment,
} from "@/lib/comments";
import type { ToolDefinition } from "./types";

export const commentsTools: ToolDefinition[] = [
  {
    schema: {
      name: "list_blog_comments",
      description:
        "List blog comments with their blog titles and moderation state, plus totals for pending, approved, and deleted.",
      input_schema: {
        type: "object",
        properties: {
          status: {
            type: "string",
            description: "Filter by moderation state.",
            enum: ["pending", "approved", "deleted"],
          },
        },
      },
    },
    isWrite: false,
    category: "comments",
    execute: async (input) => {
      const status = typeof input.status === "string" ? input.status : null;
      const [comments, stats] = await Promise.all([
        // getAllComments defaults to 100 rows and drops soft-deleted ones, so a
        // status filter applied afterwards would silently miss matches.
        getAllComments({ limit: 1_000, includeDeleted: status === "deleted" }),
        getCommentStats(),
      ]);
      const filtered = status
        ? comments.filter((comment) => {
            if (status === "deleted") return comment.isDeleted;
            if (status === "approved")
              return comment.isApproved && !comment.isDeleted;
            return !comment.isApproved && !comment.isDeleted;
          })
        : comments;
      return { comments: filtered, stats };
    },
  },
  {
    schema: {
      name: "approve_blog_comment",
      description: "Approve a pending blog comment so it appears publicly.",
      input_schema: {
        type: "object",
        properties: { id: { type: "string", description: "Comment ID" } },
        required: ["id"],
      },
    },
    isWrite: true,
    category: "comments",
    execute: async (input) => {
      const comment = await approveComment(input.id as string);
      if (!comment) throw new Error("Comment not found");
      return comment;
    },
  },
  {
    schema: {
      name: "reject_blog_comment",
      description: "Reject a pending blog comment.",
      input_schema: {
        type: "object",
        properties: { id: { type: "string", description: "Comment ID" } },
        required: ["id"],
      },
    },
    isWrite: true,
    category: "comments",
    execute: async (input) => {
      const comment = await rejectComment(input.id as string);
      if (!comment) throw new Error("Comment not found");
      return comment;
    },
  },
  {
    schema: {
      name: "delete_blog_comment",
      description:
        "Delete a blog comment. Comments that already have replies are soft-deleted so the thread survives.",
      input_schema: {
        type: "object",
        properties: { id: { type: "string", description: "Comment ID" } },
        required: ["id"],
      },
    },
    isWrite: true,
    category: "comments",
    execute: async (input) => {
      return deleteComment(input.id as string);
    },
  },
];
