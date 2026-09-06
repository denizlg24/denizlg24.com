import mongoose from "mongoose";
import { z } from "zod";

import {
  createCard,
  createColumn,
  getAllBoards,
  getFullBoard,
  linkCardEntity,
  unlinkCardEntity,
  updateCard,
  updateColumn,
} from "@/lib/kanban";
import { KanbanBoard } from "@/models/KanbanBoard";
import { KanbanCard } from "@/models/KanbanCard";
import { connectDB } from "../mongodb";
import { defineTool, objectId } from "./define";
import type { ToolDefinition } from "./types";

const COLUMN_ICON_MAP = [
  "circle",
  "clock",
  "inbox",
  "list-todo",
  "loader",
  "play",
  "arrow-right",
  "pencil",
  "code",
  "eye",
  "search",
  "test-tube",
  "check-circle",
  "check",
  "rocket",
  "flag",
  "milestone",
  "target",
  "star",
  "sparkles",
  "zap",
  "flame",
  "lightbulb",
  "bug",
  "shield",
  "alert-circle",
  "x-circle",
  "heart",
  "bookmark",
  "message-square",
  "calendar",
  "archive",
  "folder",
  "layers",
  "settings",
  "truck",
] as const;

/**
 * Every id in this module is a Mongo ObjectId. Checking the shape here is what
 * keeps a malformed one from reaching Mongoose as a CastError, which names
 * neither the field nor the tool that produces valid values.
 */
const boardId = objectId(
  "Board id (24-char hex) exactly as list_kanban_boards returned it",
);
const columnId = objectId(
  "Column id (24-char hex) exactly as list_kanban_columns returned it",
);
const cardId = objectId(
  "Card id (24-char hex) exactly as list_kanban_cards returned it",
);

const columnIcon = z
  .enum(COLUMN_ICON_MAP)
  .describe(`Column icon. One of: ${COLUMN_ICON_MAP.join(", ")}`);

const columnSortRule = z
  .enum(["manual", "priority", "dueDate"])
  .describe("How cards in the column are sorted");

const cardPriority = z.enum(["none", "low", "medium", "high", "urgent"]);

const cardEntityType = z
  .enum(["calendar", "note", "person", "course"])
  .describe(
    "Which kind of entity is attached: calendar (a calendar event), note, person (a contact) or course",
  );

const hexColor = (subject: string) =>
  z.string().describe(`${subject} as a hex string, e.g. #4f46e5`);

/** Every path out of a missing row, so none of them says only "not found". */
function missingBoard(id: string) {
  return {
    success: false as const,
    message: `No kanban board has id "${id}". Call list_kanban_boards to see the board ids that exist.`,
  };
}

function missingColumn(id: string) {
  return {
    success: false as const,
    message: `No kanban column has id "${id}". Call list_kanban_columns with the board id to see the column ids that exist.`,
  };
}

function missingCard(id: string) {
  return {
    success: false as const,
    message: `No kanban card has id "${id}". Call list_kanban_cards with the board id to see the card ids that exist.`,
  };
}

export const kanbanTools: ToolDefinition[] = [
  // ── Boards ──────────────────────────────────────────────

  defineTool({
    name: "list_kanban_boards",
    description:
      "List all active kanban boards. Returns board titles, descriptions, and IDs.",
    isWrite: false,
    category: "kanban",
    input: z.object({}),
    execute: async () => {
      return await getAllBoards();
    },
  }),
  defineTool({
    name: "get_kanban_board",
    description:
      "Get a kanban board with all its columns and cards. Use this to see the full board state.",
    isWrite: false,
    category: "kanban",
    input: z.object({ boardId }),
    execute: async (input) => {
      const board = await getFullBoard(input.boardId);
      if (!board) return missingBoard(input.boardId);
      return {
        ...board,
        columns: board.columns.map((column) => ({
          ...column,
          cards: column.cards.map((card) => ({
            ...card,
            linkCount:
              card.calendarEventIds.length +
              card.noteIds.length +
              card.personIds.length +
              card.courseIds.length,
          })),
        })),
      };
    },
  }),
  defineTool({
    name: "create_kanban_board",
    description:
      "Create a new kanban board with a title and optional description.",
    isWrite: true,
    category: "kanban",
    input: z.object({
      title: z.string().describe("Board title"),
      description: z.string().optional().describe("Board description"),
      color: hexColor("Board color").optional(),
    }),
    execute: async (input) => {
      const data = {
        title: input.title,
        description: input.description,
        color: input.color,
      };
      await connectDB();
      const board = await KanbanBoard.create(data);
      return {
        _id: board._id.toString(),
      };
    },
  }),
  defineTool({
    name: "update_kanban_board",
    description:
      "Update a kanban board's title, description, color, or archive it.",
    isWrite: true,
    category: "kanban",
    input: z.object({
      id: boardId,
      title: z.string().optional().describe("New title"),
      description: z.string().optional().describe("New description"),
      color: hexColor("New board color").optional(),
      isArchived: z
        .boolean()
        .optional()
        .describe("True archives the board, false restores it"),
    }),
    execute: async (input) => {
      const data: {
        title?: string;
        description?: string;
        color?: string;
        isArchived?: boolean;
      } = {};
      if (input.title !== undefined) data.title = input.title;
      if (input.description !== undefined) data.description = input.description;
      if (input.color !== undefined) data.color = input.color;
      if (input.isArchived !== undefined) data.isArchived = input.isArchived;
      await connectDB();
      const board = await KanbanBoard.findByIdAndUpdate(input.id, data, {
        returnDocument: "after",
      });
      if (!board) return missingBoard(input.id);
      return {
        _id: board._id.toString(),
        title: board.title,
        description: board.description,
        color: board.color,
        isArchived: board.isArchived,
      };
    },
  }),
  defineTool({
    name: "delete_kanban_board",
    description: "Delete a kanban board by its ID.",
    isWrite: true,
    category: "kanban",
    input: z.object({ id: boardId }),
    execute: async (input) => {
      await connectDB();
      const board = await KanbanBoard.findByIdAndDelete(input.id);
      if (!board) return missingBoard(input.id);
      return { success: true };
    },
  }),

  // ── Columns ─────────────────────────────────────────────

  defineTool({
    name: "list_kanban_columns",
    description:
      "List columns of a kanban board. Returns column titles, IDs, and the number of cards in each column.",
    isWrite: false,
    category: "kanban",
    input: z.object({ boardId }),
    execute: async (input) => {
      const board = await getFullBoard(input.boardId);
      if (!board) return missingBoard(input.boardId);
      return board.columns.map((col) => ({
        id: col._id,
        title: col.title,
        color: col.color,
        icon: col.icon,
        description: col.description,
        isDoneColumn: col.isDoneColumn,
        sortRule: col.sortRule,
        cardCount: col.cards.length,
      }));
    },
  }),
  defineTool({
    name: "create_kanban_column",
    description:
      "Create a new column on a kanban board. A done column makes every card in it complete; only one column per board can be the done column.",
    isWrite: true,
    category: "kanban",
    input: z.object({
      boardId,
      title: z.string().describe("Column title"),
      description: z.string().optional().describe("Column description"),
      isDoneColumn: z
        .boolean()
        .optional()
        .describe(
          "When true, cards in this column count as complete. Replaces the done column on this board.",
        ),
      sortRule: columnSortRule.optional(),
      color: hexColor("Column color").optional(),
      wipLimit: z.number().optional().describe("Work in progress limit"),
      icon: columnIcon.optional(),
    }),
    execute: async (input) => {
      const board = await getFullBoard(input.boardId);
      if (!board) return missingBoard(input.boardId);

      const column = await createColumn(input.boardId, {
        title: input.title,
        description: input.description,
        color: input.color,
        wipLimit: input.wipLimit,
        icon: input.icon,
        isDoneColumn: input.isDoneColumn,
        sortRule: input.sortRule,
      });
      return column;
    },
  }),
  defineTool({
    name: "update_kanban_column",
    description:
      "Update a kanban column, including its description, sort rule, or done semantics. Setting isDoneColumn true makes this the board's only done column.",
    isWrite: true,
    category: "kanban",
    input: z.object({
      id: columnId,
      title: z.string().optional().describe("New title"),
      description: z.string().optional().describe("New description"),
      isDoneColumn: z
        .boolean()
        .optional()
        .describe("Whether cards in this column count as complete"),
      sortRule: columnSortRule.optional(),
      color: hexColor("New column color").optional(),
      icon: columnIcon.optional(),
      wipLimit: z.number().optional().describe("New work in progress limit"),
    }),
    execute: async (input) => {
      const data: {
        title?: string;
        description?: string;
        color?: string;
        icon?: string;
        wipLimit?: number;
        isDoneColumn?: boolean;
        sortRule?: "manual" | "priority" | "dueDate";
      } = {};
      if (input.title !== undefined) data.title = input.title;
      if (input.description !== undefined) data.description = input.description;
      if (input.color !== undefined) data.color = input.color;
      if (input.icon !== undefined) data.icon = input.icon;
      if (input.wipLimit !== undefined) data.wipLimit = input.wipLimit;
      if (input.isDoneColumn !== undefined)
        data.isDoneColumn = input.isDoneColumn;
      if (input.sortRule !== undefined) data.sortRule = input.sortRule;
      const column = await updateColumn(input.id, data);
      if (!column) return missingColumn(input.id);
      return column;
    },
  }),
  defineTool({
    name: "delete_kanban_column",
    description: "Delete a kanban column and all its cards by the column ID.",
    isWrite: true,
    category: "kanban",
    input: z.object({ id: columnId }),
    execute: async (input) => {
      await connectDB();
      const { KanbanColumn } = await import("@/models/KanbanColumn");
      const column = await KanbanColumn.findByIdAndDelete(input.id);
      if (!column) return missingColumn(input.id);
      await KanbanCard.deleteMany({ columnId: input.id });
      return { success: true };
    },
  }),

  // ── Cards ───────────────────────────────────────────────

  defineTool({
    name: "list_kanban_cards",
    description:
      "List cards on a kanban board, optionally filtered by column. Returns card titles, IDs, and their column.",
    isWrite: false,
    category: "kanban",
    input: z.object({
      boardId,
      columnId: columnId
        .optional()
        .describe(
          "Column id (24-char hex) to filter by. Omit to list every column's cards.",
        ),
    }),
    execute: async (input) => {
      const board = await getFullBoard(input.boardId);
      if (!board) throw new Error(missingBoard(input.boardId).message);
      let cards = board.columns.flatMap((col) =>
        col.cards.map((card) => ({
          id: card._id,
          title: card.title,
          columnId: col._id,
          linkCount:
            card.calendarEventIds.length +
            card.noteIds.length +
            card.personIds.length +
            card.courseIds.length,
        })),
      );
      if (input.columnId) {
        cards = cards.filter((card) => card.columnId === input.columnId);
      }
      return cards;
    },
  }),
  defineTool({
    name: "create_kanban_card",
    description: "Create a new card on a kanban board in a specific column.",
    isWrite: true,
    category: "kanban",
    input: z.object({
      boardId,
      columnId: columnId.describe(
        "Column id (24-char hex) to place the card in, as list_kanban_columns returned it",
      ),
      title: z.string().describe("Card title"),
      description: z.string().optional().describe("Card description"),
      priority: cardPriority.optional().describe("Card priority"),
      dueDate: z
        .string()
        .optional()
        .describe(
          "Due date in ISO 8601, including time when one is known, e.g. 2026-09-06 or 2026-09-06T17:30:00Z",
        ),
      startDate: z
        .string()
        .optional()
        .describe("Start date in ISO 8601, e.g. 2026-09-06"),
      hasDueTime: z
        .boolean()
        .optional()
        .describe("Whether the dueDate time component is meaningful"),
      labels: z
        .array(z.string())
        .optional()
        .describe("Labels/tags for the card"),
    }),
    execute: async (input) => {
      return await createCard(input.boardId, input.columnId, {
        title: input.title,
        description: input.description,
        priority: input.priority,
        startDate: input.startDate,
        dueDate: input.dueDate,
        hasDueTime: input.hasDueTime,
        labels: input.labels,
      });
    },
  }),
  defineTool({
    name: "update_kanban_card",
    description:
      "Update an existing kanban card. Can change title, description, column, priority, etc.",
    isWrite: true,
    category: "kanban",
    input: z.object({
      id: cardId,
      title: z.string().optional().describe("New title"),
      description: z.string().optional().describe("New description"),
      columnId: columnId
        .optional()
        .describe(
          "Column id (24-char hex) to move the card to, as list_kanban_columns returned it",
        ),
      priority: cardPriority.optional().describe("New priority"),
      dueDate: z
        .string()
        .nullable()
        .optional()
        .describe(
          "New due date in ISO 8601, e.g. 2026-09-06T17:30:00Z, or null to clear",
        ),
      startDate: z
        .string()
        .nullable()
        .optional()
        .describe(
          "New start date in ISO 8601, e.g. 2026-09-06, or null to clear",
        ),
      hasDueTime: z
        .boolean()
        .optional()
        .describe("Whether the dueDate time component is meaningful"),
      isArchived: z
        .boolean()
        .optional()
        .describe("True archives the card, false restores it"),
      labels: z
        .array(z.string())
        .optional()
        .describe(
          "Full replacement label list. An empty array removes all labels.",
        ),
    }),
    execute: async (input) => {
      const data: {
        title?: string;
        description?: string;
        columnId?: string;
        priority?: string;
        startDate?: string | null;
        dueDate?: string | null;
        hasDueTime?: boolean;
        isArchived?: boolean;
        labels?: string[];
      } = {};
      if (input.title !== undefined) data.title = input.title;
      if (input.description !== undefined) data.description = input.description;
      if (input.columnId !== undefined) data.columnId = input.columnId;
      if (input.priority !== undefined) data.priority = input.priority;
      if (input.startDate !== undefined) data.startDate = input.startDate;
      if (input.dueDate !== undefined) data.dueDate = input.dueDate;
      if (input.hasDueTime !== undefined) data.hasDueTime = input.hasDueTime;
      if (input.isArchived !== undefined) data.isArchived = input.isArchived;
      if (input.labels !== undefined) data.labels = input.labels;
      const result = await updateCard(input.id, data);
      if (!result) return missingCard(input.id);
      return result;
    },
  }),
  defineTool({
    name: "link_kanban_card",
    description:
      "Attach a calendar event, note, person, or course to a kanban card.",
    isWrite: true,
    category: "kanban",
    input: z.object({
      cardId,
      entityType: cardEntityType,
      entityId: objectId(
        "Id (24-char hex) of the entity to attach, as that entity's own list tool returned it",
      ),
    }),
    execute: async (input) => {
      const card = await linkCardEntity(
        input.cardId,
        input.entityType,
        input.entityId,
      );
      return card ?? missingCard(input.cardId);
    },
  }),
  defineTool({
    name: "unlink_kanban_card",
    description:
      "Remove a calendar event, note, person, or course attachment from a kanban card.",
    isWrite: true,
    category: "kanban",
    input: z.object({
      cardId,
      entityType: cardEntityType,
      entityId: objectId(
        "Id (24-char hex) of the attached entity to remove, as get_kanban_board returned it on the card",
      ),
    }),
    execute: async (input) => {
      const card = await unlinkCardEntity(
        input.cardId,
        input.entityType,
        input.entityId,
      );
      return card ?? missingCard(input.cardId);
    },
  }),
  defineTool({
    name: "delete_kanban_card",
    description: "Delete a kanban card by its ID.",
    isWrite: true,
    category: "kanban",
    input: z.object({ id: cardId }),
    execute: async (input) => {
      const result = await updateCard(input.id, { isArchived: true });
      if (!result) return missingCard(input.id);
      return { success: true };
    },
  }),

  // ── Bulk operations ─────────────────────────────────────

  defineTool({
    name: "reorder_kanban_cards",
    description:
      "Reorder kanban cards by providing an array of card IDs with their new column and order.",
    isWrite: true,
    category: "kanban",
    input: z.object({
      items: z
        .array(
          z.object({
            id: cardId,
            columnId: columnId.describe(
              "Column id (24-char hex) the card ends up in, as list_kanban_columns returned it",
            ),
            order: z
              .number()
              .describe("New order index within the column, 0 first"),
          }),
        )
        .describe("Array of card reorder instructions"),
    }),
    execute: async (input) => {
      await connectDB();
      for (const item of input.items) {
        const columnObjectId = new mongoose.Types.ObjectId(item.columnId);
        const card = await KanbanCard.findByIdAndUpdate(item.id, {
          columnId: columnObjectId,
          order: item.order,
        });
        if (!card) return missingCard(item.id);
      }
      return { success: true };
    },
  }),
];
