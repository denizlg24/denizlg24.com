import { getAllBlogs, getBlogById, getFilteredActiveBlogs } from "@/lib/blog";
import { Blog } from "@/models/Blog";
import { connectDB } from "../mongodb";
import { triggerPublicContentRevalidation } from "../public-content-revalidation";
import type { ToolDefinition } from "./types";

function estimateReadTime(content: string): number {
  const words = content.trim().split(/\s+/).length;
  return Math.max(1, Math.ceil(words / 200));
}

export const blogTools: ToolDefinition[] = [
  // ── Read ────────────────────────────────────────────────

  {
    schema: {
      name: "list_blogs",
      description: "List all blog posts with their titles, tags, and metadata.",
      input_schema: {
        type: "object",
        properties: {},
      },
    },
    isWrite: false,
    category: "blog",
    execute: async () => {
      const blogs = await getAllBlogs();
      return blogs.map((b) => ({
        _id: b._id,
        title: b.title,
        slug: b.slug,
        excerpt: b.excerpt,
        tags: b.tags,
        isActive: b.isActive,
        timeToRead: b.timeToRead,
      }));
    },
  },
  {
    schema: {
      name: "get_blog",
      description: "Get the full content of a blog post by its ID.",
      input_schema: {
        type: "object",
        properties: {
          id: { type: "string", description: "Blog post ID" },
        },
        required: ["id"],
      },
    },
    isWrite: false,
    category: "blog",
    execute: async (input) => {
      const blog = await getBlogById(input.id as string);
      if (!blog) throw new Error("Blog post not found");
      return blog;
    },
  },
  {
    schema: {
      name: "search_blogs",
      description: "Search blog posts by query text and/or tags.",
      input_schema: {
        type: "object",
        properties: {
          query: { type: "string", description: "Search query (optional)" },
          tags: {
            type: "array",
            description: "Filter by tags (optional)",
            items: { type: "string" },
          },
        },
      },
    },
    isWrite: false,
    category: "blog",
    execute: async (input) => {
      const blogs = await getFilteredActiveBlogs({
        query: (input.query as string) ?? "",
        tags: (input.tags as string[]) ?? [],
      });
      return blogs.map((b) => ({
        _id: b._id,
        title: b.title,
        slug: b.slug,
        excerpt: b.excerpt,
        tags: b.tags,
        timeToRead: b.timeToRead,
      }));
    },
  },

  // ── Write ───────────────────────────────────────────────

  {
    schema: {
      name: "create_blog",
      description:
        "Create a new blog post with title, content, excerpt, tags, and slug.",
      input_schema: {
        type: "object",
        properties: {
          title: { type: "string", description: "Title of the blog post" },
          slug: {
            type: "string",
            description:
              "URL-friendly slug for the blog post (lowercase, hyphens)",
          },
          content: {
            type: "string",
            description: "Full content of the blog post (supports markdown)",
          },
          excerpt: {
            type: "string",
            description: "Short excerpt/summary of the blog post",
          },
          tags: {
            type: "array",
            items: { type: "string" },
            description: "Tags for the blog post",
          },
          isActive: {
            type: "boolean",
            description: "Whether the blog post is published (default: true)",
          },
        },
        required: ["title", "slug", "content", "excerpt"],
      },
    },
    isWrite: true,
    category: "blog",
    execute: async (input) => {
      await connectDB();
      const content = input.content as string;
      const doc = new Blog({
        title: input.title as string,
        slug: input.slug as string,
        content,
        excerpt: input.excerpt as string,
        tags: (input.tags as string[]) ?? [],
        timeToRead: estimateReadTime(content),
        isActive: input.isActive !== false,
      });
      const blog = await doc.save();

      await triggerPublicContentRevalidation(["blog"]);

      return {
        _id: blog._id.toString(),
        title: blog.title,
        slug: blog.slug,
        excerpt: blog.excerpt,
        tags: blog.tags,
        isActive: blog.isActive,
        timeToRead: blog.timeToRead,
      };
    },
  },
  {
    schema: {
      name: "update_blog",
      description:
        "Update an existing blog post's content, title, tags, or other fields.",
      input_schema: {
        type: "object",
        properties: {
          id: { type: "string", description: "Blog post ID to update" },
          title: { type: "string", description: "New title (optional)" },
          slug: { type: "string", description: "New slug (optional)" },
          content: {
            type: "string",
            description: "New content (optional, supports markdown)",
          },
          excerpt: { type: "string", description: "New excerpt (optional)" },
          tags: {
            type: "array",
            items: { type: "string" },
            description: "New tags (optional)",
          },
          isActive: {
            type: "boolean",
            description: "Set published state (optional)",
          },
        },
        required: ["id"],
      },
    },
    isWrite: true,
    category: "blog",
    execute: async (input) => {
      await connectDB();
      const updates: Record<string, unknown> = {};
      if (input.title !== undefined) updates.title = input.title;
      if (input.slug !== undefined) updates.slug = input.slug;
      if (input.content !== undefined) {
        updates.content = input.content;
        updates.timeToRead = estimateReadTime(input.content as string);
      }
      if (input.excerpt !== undefined) updates.excerpt = input.excerpt;
      if (input.tags !== undefined) updates.tags = input.tags;
      if (input.isActive !== undefined) updates.isActive = input.isActive;

      const blog = await Blog.findByIdAndUpdate(input.id, updates, {
        new: true,
      }).lean();
      if (!blog) throw new Error("Blog post not found");

      await triggerPublicContentRevalidation(["blog"]);

      return {
        _id: blog._id.toString(),
        title: blog.title,
        slug: blog.slug,
        excerpt: blog.excerpt,
        tags: blog.tags,
        isActive: blog.isActive,
        timeToRead: blog.timeToRead,
      };
    },
  },
  {
    schema: {
      name: "delete_blog",
      description: "Delete a blog post by its ID.",
      input_schema: {
        type: "object",
        properties: {
          id: { type: "string", description: "Blog post ID to delete" },
        },
        required: ["id"],
      },
    },
    isWrite: true,
    category: "blog",
    execute: async (input) => {
      await connectDB();
      const blog = await Blog.findByIdAndDelete(input.id as string).lean();
      if (!blog) throw new Error("Blog post not found");

      await triggerPublicContentRevalidation(["blog"]);

      return { success: true };
    },
  },
];
