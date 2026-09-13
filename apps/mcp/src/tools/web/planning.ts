import type { McpServer } from "@modelcontextprotocol/server";
import {
  timetableColorSchema,
  whiteboardAddElementsSchema,
  whiteboardBackgroundSchema,
  whiteboardComponentItemOpsSchema,
  whiteboardDeleteElementsSchema,
  whiteboardElementPatchSchema,
  whiteboardElementSchema,
} from "@repo/schemas";
import { z } from "zod";
import {
  type Api,
  action,
  defineActions,
  fail,
  fromImageResponse,
  p,
  partial,
} from "../define";

const id = z.string().min(1).describe("Mongo _id");
const byId = z.object({ id });

const timetableFields = {
  title: z.string().min(1),
  dayOfWeek: z.number().int().min(0).max(6),
  startTime: z.string().min(1).describe("HH:mm"),
  endTime: z.string().min(1).describe("HH:mm"),
  place: z.string().optional(),
  links: z
    .array(
      z.object({
        label: z.string(),
        url: z.string(),
        icon: z.string().optional(),
      }),
    )
    .optional(),
  color: timetableColorSchema.optional(),
  isActive: z.boolean().optional(),
};

const elementId = z.string().min(1).describe("Element id from get");

function boardImageMetadata(headers: Headers) {
  return {
    name: decodeURIComponent(headers.get("x-whiteboard-name") ?? ""),
    width: Number(headers.get("x-image-width")),
    height: Number(headers.get("x-image-height")),
  };
}

async function renderBoard(api: Api, path: string) {
  try {
    const response = await api.web.raw("GET", path);
    return await fromImageResponse(response, boardImageMetadata);
  } catch (error) {
    return fail(null, error instanceof Error ? error.message : String(error));
  }
}

const whiteboardContent = {
  elements: z.array(whiteboardElementSchema).optional(),
  viewState: z
    .object({ x: z.number(), y: z.number(), zoom: z.number() })
    .optional(),
  background: whiteboardBackgroundSchema.optional(),
};

export function registerWebPlanning(server: McpServer, api: Api) {
  defineActions(server, {
    name: "web_timetable",
    title: "Web: timetable",
    description: "Weekly timetable entries.",
    actions: {
      list: action({
        description: "Every entry",
        readOnly: true,
        run: () => api.web.get("/api/admin/timetable"),
      }),
      get: action({
        description: "One entry",
        input: byId,
        readOnly: true,
        run: ({ id }) => api.web.get(p`/api/admin/timetable/${id}`),
      }),
      create: action({
        description: "Adds an entry (title, dayOfWeek, startTime, endTime)",
        input: z.object(timetableFields),
        run: (body) => api.web.post("/api/admin/timetable", body),
      }),
      update: action({
        description: "Changes any field",
        input: z.object({ id, ...partial(timetableFields) }),
        idempotent: true,
        run: ({ id, ...body }) =>
          api.web.patch(p`/api/admin/timetable/${id}`, body),
      }),
      delete: action({
        description: "Deletes an entry",
        input: byId,
        destructive: true,
        run: ({ id }) => api.web.delete(p`/api/admin/timetable/${id}`),
      }),
    },
  });

  defineActions(server, {
    name: "web_journal",
    title: "Web: journal",
    description: "Daily journal logs.",
    actions: {
      list: action({
        description: "Logs, optionally within start..end",
        input: z.object({
          start: z.string().optional().describe("ISO date"),
          end: z.string().optional().describe("ISO date"),
        }),
        readOnly: true,
        run: (query) => api.web.get("/api/admin/journal", query),
      }),
      get: action({
        description: "One log",
        input: byId,
        readOnly: true,
        run: ({ id }) => api.web.get(p`/api/admin/journal/${id}`),
      }),
      create: action({
        description: "Adds a log for a date",
        input: z.object({
          date: z.string().min(1).describe("ISO date"),
          content: z.string().optional(),
        }),
        run: (body) => api.web.post("/api/admin/journal", body),
      }),
      update: action({
        description: "Replaces the content",
        input: z.object({ id, content: z.string() }),
        idempotent: true,
        run: ({ id, content }) =>
          api.web.patch(p`/api/admin/journal/${id}`, { content }),
      }),
      delete: action({
        description: "Deletes a log",
        input: byId,
        destructive: true,
        run: ({ id }) => api.web.delete(p`/api/admin/journal/${id}`),
      }),
    },
  });

  defineActions(server, {
    name: "web_whiteboards",
    title: "Web: whiteboards",
    description: "Whiteboards, including the fixed Today board.",
    actions: {
      list: action({
        description: "Every board's metadata",
        readOnly: true,
        run: () => api.web.get("/api/admin/whiteboard"),
      }),
      get: action({
        description: "One board with its elements",
        input: byId,
        readOnly: true,
        run: ({ id }) => api.web.get(p`/api/admin/whiteboard/${id}`),
      }),
      create: action({
        description: "Adds an empty board",
        input: z.object({ name: z.string().min(1) }),
        run: (body) => api.web.post("/api/admin/whiteboard", body),
      }),
      replace: action({
        description: "Sets name, elements, viewState, background or order",
        input: z.object({
          id,
          name: z.string().min(1).optional(),
          order: z.number().optional(),
          ...whiteboardContent,
        }),
        idempotent: true,
        run: ({ id, ...body }) =>
          api.web.put(p`/api/admin/whiteboard/${id}`, body),
      }),
      delete: action({
        description: "Deletes a board",
        input: byId,
        destructive: true,
        run: ({ id }) => api.web.delete(p`/api/admin/whiteboard/${id}`),
      }),
      today_get: action({
        description: "The Today board (created when missing)",
        readOnly: true,
        run: () => api.web.get("/api/admin/whiteboard/today"),
      }),
      today_replace: action({
        description: "Sets elements, viewState or background of Today",
        input: z.object(whiteboardContent),
        idempotent: true,
        run: (body) => api.web.put("/api/admin/whiteboard/today", body),
      }),
      today_delete: action({
        description: "Deletes the Today board",
        destructive: true,
        run: () => api.web.delete("/api/admin/whiteboard/today"),
      }),
      render: action({
        description: "PNG of a board as an image block",
        input: byId,
        readOnly: true,
        run: ({ id }) =>
          renderBoard(api, p`/api/admin/whiteboard/${id}/render`),
      }),
      today_render: action({
        description: "PNG of the Today board as an image block",
        readOnly: true,
        run: () => renderBoard(api, "/api/admin/whiteboard/today/render"),
      }),
      elements_add: action({
        description:
          "Appends elements; ids, z-order and default sizes are assigned",
        input: z.object({ id, ...whiteboardAddElementsSchema.shape }),
        run: ({ id, ...body }) =>
          api.web.post(p`/api/admin/whiteboard/${id}/elements`, body),
      }),
      element_update: action({
        description: "Moves, resizes, restacks or merges data into one element",
        input: z.object({
          id,
          elementId,
          ...whiteboardElementPatchSchema.shape,
        }),
        idempotent: true,
        run: ({ id, elementId, ...body }) =>
          api.web.patch(
            p`/api/admin/whiteboard/${id}/elements/${elementId}`,
            body,
          ),
      }),
      component_items: action({
        description:
          "Edits rows of a todo-list or quick-links element: update, remove, then add",
        input: z.object({
          id,
          elementId,
          ...whiteboardComponentItemOpsSchema.shape,
        }),
        run: ({ id, elementId, ...body }) =>
          api.web.patch(
            p`/api/admin/whiteboard/${id}/elements/${elementId}/items`,
            body,
          ),
      }),
      elements_delete: action({
        description: "Removes elements by id",
        input: z.object({ id, ...whiteboardDeleteElementsSchema.shape }),
        destructive: true,
        run: ({ id, ...body }) =>
          api.web.delete(
            p`/api/admin/whiteboard/${id}/elements`,
            undefined,
            body,
          ),
      }),
      today_elements_add: action({
        description: "Appends elements to Today",
        input: whiteboardAddElementsSchema,
        run: (body) =>
          api.web.post("/api/admin/whiteboard/today/elements", body),
      }),
      today_element_update: action({
        description:
          "Moves, resizes, restacks or merges data into one Today element",
        input: z.object({ elementId, ...whiteboardElementPatchSchema.shape }),
        idempotent: true,
        run: ({ elementId, ...body }) =>
          api.web.patch(
            p`/api/admin/whiteboard/today/elements/${elementId}`,
            body,
          ),
      }),
      today_component_items: action({
        description: "Edits rows of a list element on Today",
        input: z.object({
          elementId,
          ...whiteboardComponentItemOpsSchema.shape,
        }),
        run: ({ elementId, ...body }) =>
          api.web.patch(
            p`/api/admin/whiteboard/today/elements/${elementId}/items`,
            body,
          ),
      }),
      today_elements_delete: action({
        description: "Removes elements from Today by id",
        input: whiteboardDeleteElementsSchema,
        destructive: true,
        run: (body) =>
          api.web.delete(
            "/api/admin/whiteboard/today/elements",
            undefined,
            body,
          ),
      }),
    },
  });
}
