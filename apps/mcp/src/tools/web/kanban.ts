import type { McpServer } from "@modelcontextprotocol/server";
import {
  kanbanCardLinkedEntityTypeSchema,
  kanbanPrioritySchema,
} from "@repo/schemas";
import { z } from "zod";
import { type Api, action, defineActions, p, partial } from "../define";

const boardId = z.string().min(1).describe("Board _id");
const columnId = z.string().min(1).describe("Column _id");
const cardId = z.string().min(1).describe("Card _id");
const byBoard = z.object({ boardId });

const boardFields = {
  title: z.string().min(1),
  description: z.string().optional(),
  color: z.string().optional(),
};

const columnFields = {
  title: z.string().min(1),
  description: z.string().optional(),
  color: z.string().optional(),
  wipLimit: z.number().optional(),
  icon: z.string().optional(),
  isDoneColumn: z.boolean().optional(),
  isCollapsed: z.boolean().optional(),
  sortRule: z.enum(["manual", "priority", "dueDate"]).optional(),
};

const cardFields = {
  title: z.string().min(1),
  description: z.string().optional(),
  labels: z.array(z.string()).optional(),
  priority: kanbanPrioritySchema.optional(),
  startDate: z.string().nullable().optional().describe("ISO date"),
  dueDate: z.string().nullable().optional().describe("ISO date"),
  hasDueTime: z.boolean().optional(),
  calendarEventIds: z.array(z.string()).optional(),
  noteIds: z.array(z.string()).optional(),
  personIds: z.array(z.string()).optional(),
  courseIds: z.array(z.string()).optional(),
};

const entityLink = z.object({
  boardId,
  cardId,
  entityType: kanbanCardLinkedEntityTypeSchema,
  entityId: z.string().min(1),
});

export function registerWebKanban(server: McpServer, api: Api) {
  defineActions(server, {
    name: "web_kanban_boards",
    title: "Web: kanban boards",
    description: "Kanban boards.",
    actions: {
      list: action({
        description: "Every board",
        readOnly: true,
        run: () => api.web.get("/api/admin/kanban/boards"),
      }),
      get: action({
        description: "One board",
        input: byBoard,
        readOnly: true,
        run: ({ boardId }) =>
          api.web.get(p`/api/admin/kanban/boards/${boardId}`),
      }),
      create: action({
        description: "Adds a board",
        input: z.object(boardFields),
        run: (body) => api.web.post("/api/admin/kanban/boards", body),
      }),
      update: action({
        description: "Changes title, description, color or isArchived",
        input: z.object({
          boardId,
          ...partial(boardFields),
          isArchived: z.boolean().optional(),
        }),
        idempotent: true,
        run: ({ boardId, ...body }) =>
          api.web.patch(p`/api/admin/kanban/boards/${boardId}`, body),
      }),
      delete: action({
        description: "Deletes a board with its columns and cards",
        input: byBoard,
        destructive: true,
        run: ({ boardId }) =>
          api.web.delete(p`/api/admin/kanban/boards/${boardId}`),
      }),
      upcoming: action({
        description: "Cards due within days (default 7, max 90)",
        input: z.object({ days: z.number().int().min(1).max(90).optional() }),
        readOnly: true,
        run: ({ days }) => api.web.get("/api/admin/kanban/upcoming", { days }),
      }),
    },
  });

  defineActions(server, {
    name: "web_kanban_columns",
    title: "Web: kanban columns",
    description: "Columns of a kanban board.",
    actions: {
      list: action({
        description: "Columns of a board in order",
        input: byBoard,
        readOnly: true,
        run: ({ boardId }) =>
          api.web.get(p`/api/admin/kanban/boards/${boardId}/columns`),
      }),
      create: action({
        description: "Adds a column at the end",
        input: z.object({ boardId, ...columnFields }),
        run: ({ boardId, ...body }) =>
          api.web.post(p`/api/admin/kanban/boards/${boardId}/columns`, body),
      }),
      update: action({
        description: "Changes any field",
        input: z.object({ boardId, columnId, ...partial(columnFields) }),
        idempotent: true,
        run: ({ boardId, columnId, ...body }) =>
          api.web.patch(
            p`/api/admin/kanban/boards/${boardId}/columns/${columnId}`,
            body,
          ),
      }),
      delete: action({
        description: "Deletes a column and its cards",
        input: z.object({ boardId, columnId }),
        destructive: true,
        run: ({ boardId, columnId }) =>
          api.web.delete(
            p`/api/admin/kanban/boards/${boardId}/columns/${columnId}`,
          ),
      }),
      reorder: action({
        description: "Sets order per _id",
        input: z.object({
          boardId,
          items: z
            .array(z.object({ _id: z.string().min(1), order: z.number() }))
            .min(1),
        }),
        idempotent: true,
        run: ({ boardId, items }) =>
          api.web.patch(
            p`/api/admin/kanban/boards/${boardId}/columns/reorder`,
            { items },
          ),
      }),
      clear: action({
        description: "Deletes every card in a column",
        input: z.object({ boardId, columnId }),
        destructive: true,
        run: ({ boardId, columnId }) =>
          api.web.delete(
            p`/api/admin/kanban/boards/${boardId}/columns/${columnId}/cards`,
          ),
      }),
    },
  });

  defineActions(server, {
    name: "web_kanban_cards",
    title: "Web: kanban cards",
    description: "Cards on a kanban board.",
    actions: {
      list: action({
        description: "Cards of a board, optionally one column",
        input: z.object({ boardId, columnId: columnId.optional() }),
        readOnly: true,
        run: ({ boardId, columnId }) =>
          api.web.get(p`/api/admin/kanban/boards/${boardId}/cards`, {
            columnId,
          }),
      }),
      get: action({
        description: "One card with its linked entities",
        input: z.object({ boardId, cardId }),
        readOnly: true,
        run: ({ boardId, cardId }) =>
          api.web.get(p`/api/admin/kanban/boards/${boardId}/cards/${cardId}`),
      }),
      create: action({
        description: "Adds a card to a column",
        input: z.object({ boardId, columnId, ...cardFields }),
        run: ({ boardId, ...body }) =>
          api.web.post(p`/api/admin/kanban/boards/${boardId}/cards`, body),
      }),
      update: action({
        description: "Changes any field, including columnId, order, isArchived",
        input: z.object({
          boardId,
          cardId,
          columnId: columnId.optional(),
          order: z.number().optional(),
          isArchived: z.boolean().optional(),
          ...partial(cardFields),
        }),
        idempotent: true,
        run: ({ boardId, cardId, ...body }) =>
          api.web.patch(
            p`/api/admin/kanban/boards/${boardId}/cards/${cardId}`,
            body,
          ),
      }),
      delete: action({
        description: "Deletes a card",
        input: z.object({ boardId, cardId }),
        destructive: true,
        run: ({ boardId, cardId }) =>
          api.web.delete(
            p`/api/admin/kanban/boards/${boardId}/cards/${cardId}`,
          ),
      }),
      reorder: action({
        description: "Sets columnId and order per _id",
        input: z.object({
          boardId,
          items: z
            .array(
              z.object({
                _id: z.string().min(1),
                columnId: z.string().min(1),
                order: z.number(),
              }),
            )
            .min(1),
        }),
        idempotent: true,
        run: ({ boardId, items }) =>
          api.web.patch(p`/api/admin/kanban/boards/${boardId}/cards/reorder`, {
            items,
          }),
      }),
      link: action({
        description: "Links a calendar event, note, person or course",
        input: entityLink,
        idempotent: true,
        run: ({ boardId, cardId, ...body }) =>
          api.web.post(
            p`/api/admin/kanban/boards/${boardId}/cards/${cardId}/links`,
            body,
          ),
      }),
      unlink: action({
        description: "Removes a link",
        input: entityLink,
        idempotent: true,
        run: ({ boardId, cardId, ...query }) =>
          api.web.delete(
            p`/api/admin/kanban/boards/${boardId}/cards/${cardId}/links`,
            query,
          ),
      }),
    },
  });
}
