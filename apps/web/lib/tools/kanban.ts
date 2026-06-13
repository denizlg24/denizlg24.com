import mongoose from "mongoose";
import {
  createCard,
  createColumn,
  getAllBoards,
  getFullBoard,
  updateCard,
  updateColumn,
} from "@/lib/kanban";
import { KanbanBoard } from "@/models/KanbanBoard";
import { KanbanCard, type KanbanPriority } from "@/models/KanbanCard";
import { connectDB } from "../mongodb";
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
];

export const kanbanTools: ToolDefinition[] = [
  // ── Boards ──────────────────────────────────────────────

  {
    schema: {
      name: "list_kanban_boards",
      description:
        "List all active kanban boards. Returns board titles, descriptions, and IDs.",
      input_schema: {
        type: "object",
        properties: {},
      },
    },
    isWrite: false,
    category: "kanban",
    execute: async () => {
      return await getAllBoards();
    },
  },
  {
    schema: {
      name: "get_kanban_board",
      description:
        "Get a kanban board with all its columns and cards. Use this to see the full board state.",
      input_schema: {
        type: "object",
        properties: {
          boardId: { type: "string", description: "Board ID" },
        },
        required: ["boardId"],
      },
    },
    isWrite: false,
    category: "kanban",
    execute: async (input) => {
      const board = await getFullBoard(input.boardId as string);
      if (!board) return { success: false, message: "Board not found" };
      return board;
    },
  },
  {
    schema: {
      name: "create_kanban_board",
      description:
        "Create a new kanban board with a title and optional description.",
      input_schema: {
        type: "object",
        properties: {
          title: { type: "string", description: "Board title" },
          description: {
            type: "string",
            description: "Board description (optional)",
          },
          color: {
            type: "string",
            description: "Board color in hex (optional)",
          },
        },
        required: ["title"],
      },
    },
    isWrite: true,
    category: "kanban",
    execute: async (input) => {
      const data = {
        title: input.title as string,
        description: input.description as string | undefined,
        color: input.color as string | undefined,
      };
      await connectDB();
      const board = await KanbanBoard.create(data);
      return {
        _id: board._id.toString(),
      };
    },
  },
  {
    schema: {
      name: "update_kanban_board",
      description:
        "Update a kanban board's title, description, color, or archive it.",
      input_schema: {
        type: "object",
        properties: {
          id: { type: "string", description: "Board ID" },
          title: { type: "string", description: "New title (optional)" },
          description: {
            type: "string",
            description: "New description (optional)",
          },
          color: { type: "string", description: "New color in hex (optional)" },
          isArchived: {
            type: "boolean",
            description: "Archive or unarchive the board (optional)",
          },
        },
        required: ["id"],
      },
    },
    isWrite: true,
    category: "kanban",
    execute: async (input) => {
      const data: Record<string, unknown> = {};
      if (input.title !== undefined) data.title = input.title;
      if (input.description !== undefined) data.description = input.description;
      if (input.color !== undefined) data.color = input.color;
      if (input.isArchived !== undefined) data.isArchived = input.isArchived;
      await connectDB();
      const board = await KanbanBoard.findByIdAndUpdate(
        input.id as string,
        data,
        { returnDocument: "after" },
      );
      if (!board) return { success: false, message: "Board not found" };
      return {
        _id: board._id.toString(),
        title: board.title,
        description: board.description,
        color: board.color,
        isArchived: board.isArchived,
      };
    },
  },
  {
    schema: {
      name: "delete_kanban_board",
      description: "Delete a kanban board by its ID.",
      input_schema: {
        type: "object",
        properties: {
          id: { type: "string", description: "Board ID" },
        },
        required: ["id"],
      },
    },
    isWrite: true,
    category: "kanban",
    execute: async (input) => {
      await connectDB();
      const board = await KanbanBoard.findByIdAndDelete(input.id as string);
      if (!board) return { success: false, message: "Board not found" };
      return { success: true };
    },
  },

  // ── Columns ─────────────────────────────────────────────

  {
    schema: {
      name: "list_kanban_columns",
      description:
        "List columns of a kanban board. Returns column titles, IDs, and the number of cards in each column.",
      input_schema: {
        type: "object",
        properties: {
          boardId: { type: "string", description: "Board ID" },
        },
        required: ["boardId"],
      },
    },
    isWrite: false,
    category: "kanban",
    execute: async (input) => {
      const board = await getFullBoard(input.boardId as string);
      if (!board) return { success: false, message: "Board not found" };
      return board.columns.map((col) => ({
        id: col._id,
        title: col.title,
        color: col.color,
        icon: col.icon,
        cardCount: col.cards.length,
      }));
    },
  },
  {
    schema: {
      name: "create_kanban_column",
      description: "Create a new column on a kanban board.",
      input_schema: {
        type: "object",
        properties: {
          boardId: { type: "string", description: "Board ID" },
          title: { type: "string", description: "Column title" },
          color: {
            type: "string",
            description: "Column color in hex (optional)",
          },
          wipLimit: {
            type: "number",
            description: "Work in progress limit (optional)",
          },
          icon: {
            type: "string",
            description: `Column icon (optional) - Must be one of: ${COLUMN_ICON_MAP.join(", ")}`,
          },
        },
        required: ["boardId", "title"],
      },
    },
    isWrite: true,
    category: "kanban",
    execute: async (input) => {
      const board = await getFullBoard(input.boardId as string);
      if (!board) return { success: false, message: "Board not found" };

      if (input.icon && !COLUMN_ICON_MAP.includes(input.icon as string)) {
        return {
          success: false,
          message: `Invalid icon. Must be one of: ${COLUMN_ICON_MAP.join(", ")}`,
        };
      }
      const column = await createColumn(input.boardId as string, {
        title: input.title as string,
        color: input.color as string | undefined,
        wipLimit: input.wipLimit as number | undefined,
        icon: input.icon as string | undefined,
      });
      return column;
    },
  },
  {
    schema: {
      name: "update_kanban_column",
      description:
        "Update an existing kanban column's title, color, icon, or WIP limit.",
      input_schema: {
        type: "object",
        properties: {
          id: { type: "string", description: "Column ID" },
          title: { type: "string", description: "New title (optional)" },
          color: {
            type: "string",
            description: "New color in hex (optional)",
          },
          icon: {
            type: "string",
            description: `New icon (optional) - Must be one of: ${COLUMN_ICON_MAP.join(", ")}`,
          },
          wipLimit: {
            type: "number",
            description: "New work in progress limit (optional)",
          },
        },
        required: ["id"],
      },
    },
    isWrite: true,
    category: "kanban",
    execute: async (input) => {
      if (input.icon && !COLUMN_ICON_MAP.includes(input.icon as string)) {
        return {
          success: false,
          message: `Invalid icon. Must be one of: ${COLUMN_ICON_MAP.join(", ")}`,
        };
      }
      const data: Record<string, unknown> = {};
      if (input.title !== undefined) data.title = input.title;
      if (input.color !== undefined) data.color = input.color;
      if (input.icon !== undefined) data.icon = input.icon;
      if (input.wipLimit !== undefined) data.wipLimit = input.wipLimit;
      const column = await updateColumn(input.id as string, data);
      if (!column) return { success: false, message: "Column not found" };
      return column;
    },
  },
  {
    schema: {
      name: "delete_kanban_column",
      description: "Delete a kanban column and all its cards by the column ID.",
      input_schema: {
        type: "object",
        properties: {
          id: { type: "string", description: "Column ID" },
        },
        required: ["id"],
      },
    },
    isWrite: true,
    category: "kanban",
    execute: async (input) => {
      await connectDB();
      const { KanbanColumn } = await import("@/models/KanbanColumn");
      const column = await KanbanColumn.findByIdAndDelete(input.id as string);
      if (!column) return { success: false, message: "Column not found" };
      await KanbanCard.deleteMany({ columnId: input.id as string });
      return { success: true };
    },
  },

  // ── Cards ───────────────────────────────────────────────

  {
    schema: {
      name: "list_kanban_cards",
      description:
        "List cards on a kanban board, optionally filtered by column. Returns card titles, IDs, and their column.",
      input_schema: {
        type: "object",
        properties: {
          boardId: { type: "string", description: "Board ID" },
          columnId: {
            type: "string",
            description: "Column ID to filter by (optional)",
          },
        },
        required: ["boardId"],
      },
    },
    isWrite: false,
    category: "kanban",
    execute: async (input) => {
      const board = await getFullBoard(input.boardId as string);
      if (!board) throw new Error("Board not found");
      let cards = board.columns.flatMap((col) =>
        col.cards.map((card) => ({
          id: card._id,
          title: card.title,
          columnId: col._id,
        })),
      );
      if (input.columnId) {
        cards = cards.filter((card) => card.columnId === input.columnId);
      }
      return cards;
    },
  },
  {
    schema: {
      name: "create_kanban_card",
      description: "Create a new card on a kanban board in a specific column.",
      input_schema: {
        type: "object",
        properties: {
          boardId: { type: "string", description: "Board ID" },
          columnId: {
            type: "string",
            description: "Column ID to place the card in",
          },
          title: { type: "string", description: "Card title" },
          description: {
            type: "string",
            description: "Card description (optional)",
          },
          priority: {
            type: "string",
            description: "Card priority (optional)",
            enum: ["none", "low", "medium", "high", "urgent"],
          },
          dueDate: {
            type: "string",
            description: "Due date in ISO 8601 (optional)",
          },
          labels: {
            type: "array",
            description: "Labels/tags for the card (optional)",
            items: { type: "string" },
          },
        },
        required: ["boardId", "columnId", "title"],
      },
    },
    isWrite: true,
    category: "kanban",
    execute: async (input) => {
      return await createCard(
        input.boardId as string,
        input.columnId as string,
        {
          title: input.title as string,
          description: input.description as string | undefined,
          priority: input.priority as KanbanPriority | undefined,
          dueDate: input.dueDate as string | undefined,
          labels: input.labels as string[] | undefined,
        },
      );
    },
  },
  {
    schema: {
      name: "update_kanban_card",
      description:
        "Update an existing kanban card. Can change title, description, column, priority, etc.",
      input_schema: {
        type: "object",
        properties: {
          id: { type: "string", description: "Card ID" },
          title: { type: "string", description: "New title (optional)" },
          description: {
            type: "string",
            description: "New description (optional)",
          },
          columnId: {
            type: "string",
            description: "Move to this column (optional)",
          },
          priority: {
            type: "string",
            description: "New priority (optional)",
            enum: ["none", "low", "medium", "high", "urgent"],
          },
          dueDate: {
            type: "string",
            description:
              "New due date in ISO 8601, or null to clear (optional)",
          },
          isArchived: {
            type: "boolean",
            description: "Archive or unarchive the card (optional)",
          },
        },
        required: ["id"],
      },
    },
    isWrite: true,
    category: "kanban",
    execute: async (input) => {
      const data: Record<string, unknown> = {};
      if (input.title !== undefined) data.title = input.title;
      if (input.description !== undefined) data.description = input.description;
      if (input.columnId !== undefined) data.columnId = input.columnId;
      if (input.priority !== undefined) data.priority = input.priority;
      if (input.dueDate !== undefined) data.dueDate = input.dueDate;
      if (input.isArchived !== undefined) data.isArchived = input.isArchived;
      const result = await updateCard(input.id as string, data);
      if (!result) return { success: false, message: "Card not found" };
      return result;
    },
  },
  {
    schema: {
      name: "delete_kanban_card",
      description: "Delete a kanban card by its ID.",
      input_schema: {
        type: "object",
        properties: {
          id: { type: "string", description: "Card ID" },
        },
        required: ["id"],
      },
    },
    isWrite: true,
    category: "kanban",
    execute: async (input) => {
      const result = await updateCard(input.id as string, { isArchived: true });
      if (!result) return { success: false, message: "Card not found" };
      return { success: true };
    },
  },

  // ── Bulk operations ─────────────────────────────────────

  {
    schema: {
      name: "reorder_kanban_cards",
      description:
        "Reorder kanban cards by providing an array of card IDs with their new column and order.",
      input_schema: {
        type: "object",
        properties: {
          items: {
            type: "array",
            description: "Array of card reorder instructions",
            items: {
              type: "object",
              properties: {
                id: { type: "string", description: "Card ID" },
                columnId: { type: "string", description: "New column ID" },
                order: {
                  type: "number",
                  description: "New order index within the column",
                },
              },
              required: ["id", "columnId", "order"],
            },
          },
        },
        required: ["items"],
      },
    },
    isWrite: true,
    category: "kanban",
    execute: async (input) => {
      const items = input.items as {
        id: string;
        columnId: string;
        order: number;
      }[];
      await connectDB();
      for (const item of items) {
        const columnId = new mongoose.Types.ObjectId(item.columnId);
        const card = await KanbanCard.findByIdAndUpdate(item.id, {
          columnId,
          order: item.order,
        });
        if (!card)
          return {
            success: false,
            message: `Card with ID ${item.id} not found`,
          };
      }
      return { success: true };
    },
  },
];
