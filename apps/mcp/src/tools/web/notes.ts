import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import {
  type Api,
  action,
  defineActions,
  fromResponse,
  p,
  partial,
} from "../define";

const noteId = z.string().min(1).describe("Note _id");
const byNote = z.object({ noteId });
const id = z.string().min(1).describe("Mongo _id");
const byId = z.object({ id });

const noteStatus = z.enum(["open", "archived"]);

const noteFields = {
  title: z.string().optional(),
  url: z.string().optional(),
  content: z.string().optional().describe("Markdown"),
  description: z.string().optional(),
  class: z.string().optional(),
  tags: z.array(z.string()).optional(),
  groupIds: z.array(z.string()).optional(),
  status: noteStatus.optional(),
  publishedDate: z.string().nullable().optional().describe("ISO date"),
};

const noteEditFields = {
  ...noteFields,
  siteName: z.string().optional(),
  favicon: z.string().optional(),
  image: z.string().optional(),
  voiceNoteIds: z.array(z.string()).optional(),
};

const categorizeFields = {
  title: z.string().optional(),
  content: z.string().optional(),
  description: z.string().optional(),
  siteName: z.string().optional(),
  url: z.string().optional(),
};

const groupFields = {
  name: z.string().min(1),
  description: z.string().optional(),
  color: z.string().optional(),
  parentId: z.string().nullable().optional(),
};

export function registerWebNotes(server: McpServer, api: Api) {
  defineActions(server, {
    name: "web_notes",
    title: "Web: notes",
    description: "Notes, saved links and their categorisation.",
    actions: {
      list: action({
        description: "Every note, group and edge plus semantic counts",
        readOnly: true,
        run: () => api.web.get("/api/admin/notes"),
      }),
      get: action({
        description: "One note",
        input: byNote,
        readOnly: true,
        run: ({ noteId }) => api.web.get(p`/api/admin/notes/${noteId}`),
      }),
      create: action({
        description:
          "Adds a note; a url fetches metadata unless skipMetadataFetch",
        input: z.object({
          ...noteFields,
          metadata: z.record(z.string(), z.unknown()).optional(),
          skipMetadataFetch: z.boolean().optional(),
          skipCategorize: z.boolean().optional(),
          useLegacyLlmCategorization: z.boolean().optional(),
        }),
        run: (body) => api.web.post("/api/admin/notes", body),
      }),
      update: action({
        description: "Changes any field (PATCH)",
        input: z.object({ noteId, ...partial(noteEditFields) }),
        idempotent: true,
        run: ({ noteId, ...body }) =>
          api.web.patch(p`/api/admin/notes/${noteId}`, body),
      }),
      replace: action({
        description: "Same fields as update, sent as PUT",
        input: z.object({ noteId, ...partial(noteEditFields) }),
        idempotent: true,
        run: ({ noteId, ...body }) =>
          api.web.put(p`/api/admin/notes/${noteId}`, body),
      }),
      delete: action({
        description: "Deletes a note (409 when linked to a paper)",
        input: byNote,
        destructive: true,
        run: ({ noteId }) => api.web.delete(p`/api/admin/notes/${noteId}`),
      }),
      rename: action({
        description: "Sets the title",
        input: z.object({ noteId, name: z.string().min(1) }),
        idempotent: true,
        run: ({ noteId, name }) =>
          api.web.put(p`/api/admin/notes/${noteId}/name`, { name }),
      }),
      categorize: action({
        description:
          "Recomputes tags and groups; fields override the stored note",
        input: z.object({ noteId, ...categorizeFields }),
        run: ({ noteId, ...body }) =>
          api.web.post(p`/api/admin/notes/${noteId}/categorize`, body),
      }),
      export: action({
        description: "Markdown file of a note",
        input: byNote,
        readOnly: true,
        run: async ({ noteId }) =>
          fromResponse(
            await api.web.raw("GET", p`/api/admin/notes/${noteId}/download`),
          ),
      }),
      tags: action({
        description: "Every tag in use",
        readOnly: true,
        run: () => api.web.get("/api/admin/notes/tags"),
      }),
    },
  });

  defineActions(server, {
    name: "web_note_edges",
    title: "Web: note edges",
    description: "Links between two notes.",
    actions: {
      create: action({
        description: "Links two notes",
        input: z.object({
          from: noteId,
          to: noteId,
          reason: z.string().optional(),
        }),
        run: (body) => api.web.post("/api/admin/notes/edges", body),
      }),
      delete: action({
        description: "Removes an edge",
        input: z.object({ edgeId: z.string().min(1).describe("Edge _id") }),
        destructive: true,
        run: ({ edgeId }) =>
          api.web.delete(p`/api/admin/notes/edges/${edgeId}`),
      }),
    },
  });

  defineActions(server, {
    name: "web_note_groups",
    title: "Web: note groups",
    description: "Groups notes belong to; nestable through parentId.",
    actions: {
      list: action({
        description: "Every group",
        readOnly: true,
        run: () => api.web.get("/api/admin/note-groups"),
      }),
      create: action({
        description: "Adds a group",
        input: z.object(groupFields),
        run: (body) => api.web.post("/api/admin/note-groups", body),
      }),
      update: action({
        description: "Changes any field; parentId null or empty unnests",
        input: z.object({ id, ...partial(groupFields) }),
        idempotent: true,
        run: ({ id, ...body }) =>
          api.web.patch(p`/api/admin/note-groups/${id}`, body),
      }),
      delete: action({
        description: "Deletes a group and detaches its notes",
        input: byId,
        destructive: true,
        run: ({ id }) => api.web.delete(p`/api/admin/note-groups/${id}`),
      }),
    },
  });
}
