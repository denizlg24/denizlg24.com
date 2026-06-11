import { z } from "zod";

export const blogSchema = z.object({
  _id: z.string(),
  slug: z.string(),
  title: z.string(),
  excerpt: z.string(),
  content: z.string(),
  timeToRead: z.number(),
  media: z.array(z.string()).optional(),
  tags: z.array(z.string()).optional(),
  isActive: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type IBlog = z.infer<typeof blogSchema>;

export const blogCommentSchema = z.object({
  _id: z.string(),
  blogId: z.string(),
  commentId: z.string().optional(),
  authorName: z.string(),
  content: z.string(),
  sessionId: z.string().optional(),
  isApproved: z.boolean(),
  isDeleted: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type IBlogComment = z.infer<typeof blogCommentSchema>;

export const blogViewSchema = z.object({
  _id: z.string(),
  blogId: z.string(),
  views: z.number(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type IBlogView = z.infer<typeof blogViewSchema>;

export const blogUpdateSchema = z
  .object({
    title: z.string().min(1).optional(),
    excerpt: z.string().optional(),
    content: z.string().optional(),
    tags: z.array(z.string()).optional(),
    media: z.array(z.string()).optional(),
    isActive: z.boolean().optional(),
  })
  .strict();
export type BlogUpdateInput = z.infer<typeof blogUpdateSchema>;
