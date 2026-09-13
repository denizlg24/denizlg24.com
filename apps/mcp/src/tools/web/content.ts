import type { McpServer } from "@modelcontextprotocol/server";
import { blogUpdateSchema } from "@repo/schemas";
import { z } from "zod";
import { type Api, action, defineActions, p, partial } from "../define";

const id = z.string().min(1).describe("Mongo _id");
const byId = z.object({ id });
const reorderItems = z
  .array(z.object({ _id: z.string().min(1), order: z.number() }))
  .min(1);

const link = z.object({
  label: z.string(),
  url: z.string(),
  icon: z.enum(["external", "github", "notepad"]),
});

export function registerWebContent(server: McpServer, api: Api) {
  defineActions(server, {
    name: "web_blogs",
    title: "Web: blog posts",
    description: "Blog posts on denizlg24.com.",
    actions: {
      list: action({
        description: "Every post with reading time and status",
        readOnly: true,
        run: () => api.web.get("/api/admin/blogs"),
      }),
      get: action({
        description: "One post by id",
        input: byId,
        readOnly: true,
        run: ({ id }) => api.web.get(p`/api/admin/blogs/${id}`),
      }),
      create: action({
        description:
          "Publishes or drafts a post (slug and reading time derived)",
        input: z.object({
          title: z.string().min(1),
          excerpt: z.string(),
          content: z.string().describe("Markdown"),
          tags: z.array(z.string()).optional(),
          media: z.array(z.string()).optional(),
          references: z
            .array(z.object({ label: z.string(), url: z.string() }))
            .optional(),
          isActive: z.boolean().optional(),
        }),
        run: (body) => api.web.post("/api/admin/blogs", body),
      }),
      update: action({
        description: "Changes any field of a post",
        input: z.object({ id, ...blogUpdateSchema.shape }),
        idempotent: true,
        run: ({ id, ...body }) =>
          api.web.patch(p`/api/admin/blogs/${id}`, body),
      }),
      toggle: action({
        description: "Flips isActive",
        input: byId,
        run: ({ id }) =>
          api.web.patch(p`/api/admin/blogs/${id}`, { toggleActive: true }),
      }),
      delete: action({
        description: "Deletes a post",
        input: byId,
        destructive: true,
        run: ({ id }) => api.web.delete(p`/api/admin/blogs/${id}`),
      }),
    },
  });

  defineActions(server, {
    name: "web_comments",
    title: "Web: blog comments",
    description: "Moderation of public blog comments.",
    actions: {
      list: action({
        description: "Every comment with blog title and counts",
        readOnly: true,
        run: () => api.web.get("/api/admin/comments"),
      }),
      approve: action({
        description: "Approves a pending comment",
        input: byId,
        idempotent: true,
        run: ({ id }) =>
          api.web.patch(p`/api/admin/comments/${id}`, { action: "approve" }),
      }),
      reject: action({
        description: "Rejects a comment",
        input: byId,
        idempotent: true,
        run: ({ id }) =>
          api.web.patch(p`/api/admin/comments/${id}`, { action: "reject" }),
      }),
      delete: action({
        description: "Deletes a comment (soft-deleted when it has replies)",
        input: byId,
        destructive: true,
        run: ({ id }) => api.web.delete(p`/api/admin/comments/${id}`),
      }),
    },
  });

  const ticketId = z.string().min(1).describe("Contact ticket id");
  defineActions(server, {
    name: "web_contacts",
    title: "Web: contact tickets",
    description: "Messages sent through the public contact form.",
    actions: {
      list: action({
        description: "Every ticket plus counts per status",
        readOnly: true,
        run: () => api.web.get("/api/admin/contacts"),
      }),
      get: action({
        description: "One ticket",
        input: z.object({ ticketId }),
        readOnly: true,
        run: ({ ticketId }) => api.web.get(p`/api/admin/contacts/${ticketId}`),
      }),
      set_status: action({
        description: "pending, read, responded or archived",
        input: z.object({
          ticketId,
          status: z.enum(["pending", "read", "responded", "archived"]),
        }),
        idempotent: true,
        run: ({ ticketId, status }) =>
          api.web.patch(p`/api/admin/contacts/${ticketId}`, { status }),
      }),
      mark_email_sent: action({
        description: "Records that a reply email went out",
        input: z.object({ ticketId }),
        idempotent: true,
        run: ({ ticketId }) =>
          api.web.patch(p`/api/admin/contacts/${ticketId}`, {
            emailSent: true,
          }),
      }),
      delete: action({
        description: "Deletes a ticket",
        input: z.object({ ticketId }),
        destructive: true,
        run: ({ ticketId }) =>
          api.web.delete(p`/api/admin/contacts/${ticketId}`),
      }),
      purge_archived: action({
        description: "Deletes every archived ticket",
        destructive: true,
        run: () => api.web.delete("/api/admin/contacts/archived"),
      }),
    },
  });

  const projectFields = {
    title: z.string().min(1),
    subtitle: z.string(),
    images: z.array(z.string()),
    media: z.array(z.string()).optional(),
    links: z.array(link),
    markdown: z.string(),
    tags: z.array(z.string()).optional(),
    topicGroups: z.array(z.string()).optional(),
    isActive: z.boolean().optional(),
    isFeatured: z.boolean().optional(),
  };
  defineActions(server, {
    name: "web_projects",
    title: "Web: portfolio projects",
    description: "Projects shown on the public portfolio.",
    actions: {
      list: action({
        description: "Every project in display order",
        readOnly: true,
        run: () => api.web.get("/api/admin/projects"),
      }),
      get: action({
        description: "One project",
        input: byId,
        readOnly: true,
        run: ({ id }) => api.web.get(p`/api/admin/projects/${id}`),
      }),
      create: action({
        description: "Adds a project at the end of the order",
        input: z.object(projectFields),
        run: (body) => api.web.post("/api/admin/projects", body),
      }),
      update: action({
        description: "Changes any field",
        input: z.object({
          id,
          ...partial(projectFields),
          sourceRepository: z
            .object({
              provider: z.literal("github"),
              owner: z.string(),
              repo: z.string(),
              url: z.string(),
              branch: z.string().optional(),
            })
            .optional(),
        }),
        idempotent: true,
        run: ({ id, ...body }) =>
          api.web.patch(p`/api/admin/projects/${id}`, body),
      }),
      toggle_active: action({
        description: "Flips isActive",
        input: byId,
        run: ({ id }) =>
          api.web.patch(p`/api/admin/projects/${id}`, { toggleActive: true }),
      }),
      toggle_featured: action({
        description: "Flips isFeatured",
        input: byId,
        run: ({ id }) =>
          api.web.patch(p`/api/admin/projects/${id}`, { toggleFeatured: true }),
      }),
      delete: action({
        description: "Deletes a project",
        input: byId,
        destructive: true,
        run: ({ id }) => api.web.delete(p`/api/admin/projects/${id}`),
      }),
      reorder: action({
        description: "Sets order per _id",
        input: z.object({ items: reorderItems }),
        idempotent: true,
        run: (body) => api.web.patch("/api/admin/projects/reorder", body),
      }),
    },
  });

  const timelineCategory = z.enum(["work", "education", "personal"]);
  const timelineFields = {
    title: z.string().min(1),
    subtitle: z.string().min(1),
    logoUrl: z.string().optional(),
    dateFrom: z.string().describe("ISO date"),
    dateTo: z.string().optional().describe("ISO date; absent = present"),
    topics: z.array(z.string()).optional(),
    category: timelineCategory,
    links: z.array(link).optional(),
    isActive: z.boolean().optional(),
  };
  defineActions(server, {
    name: "web_timeline",
    title: "Web: timeline",
    description:
      "Work, education and personal timeline entries on the public site.",
    actions: {
      list: action({
        description: "Entries, optionally one category",
        input: z.object({ category: timelineCategory.optional() }),
        readOnly: true,
        run: ({ category }) => api.web.get("/api/admin/timeline", { category }),
      }),
      get: action({
        description: "One entry",
        input: byId,
        readOnly: true,
        run: ({ id }) => api.web.get(p`/api/admin/timeline/${id}`),
      }),
      create: action({
        description: "Adds an entry at the end of its category",
        input: z.object(timelineFields),
        run: (body) => api.web.post("/api/admin/timeline", body),
      }),
      update: action({
        description: "Changes any field",
        input: z.object({
          id,
          ...partial(timelineFields),
        }),
        idempotent: true,
        run: ({ id, ...body }) =>
          api.web.patch(p`/api/admin/timeline/${id}`, body),
      }),
      toggle: action({
        description: "Flips isActive",
        input: byId,
        run: ({ id }) =>
          api.web.patch(p`/api/admin/timeline/${id}`, { toggleActive: true }),
      }),
      delete: action({
        description: "Deletes an entry",
        input: byId,
        destructive: true,
        run: ({ id }) => api.web.delete(p`/api/admin/timeline/${id}`),
      }),
      reorder: action({
        description: "Sets order per _id",
        input: z.object({ items: reorderItems }),
        idempotent: true,
        run: (body) => api.web.patch("/api/admin/timeline/reorder", body),
      }),
    },
  });
}
