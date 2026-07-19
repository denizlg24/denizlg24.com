import { z } from "zod";
import { getTodayBoard, updateTodayBoard } from "@/lib/whiteboard";
import type { ILeanWhiteboard } from "@/models/Whiteboard";
import type { ToolDefinition } from "./types";
import {
  applyElementPatch,
  boardSummary,
  buildNewElements,
  ELEMENT_DATA_GUIDE,
  maxZIndex,
  parseBackground,
  renderBoardImage,
  summarizeElement,
} from "./whiteboard";

const TODAY_BOARD_NOTE =
  "The Today board is the daily scratch whiteboard: it is archived to the journal and cleared every night, so it always reflects the current day.";

async function requireTodayBoard(): Promise<
  { ok: true; board: ILeanWhiteboard } | { ok: false; error: string }
> {
  const board = await getTodayBoard();
  if (!board) return { ok: false, error: "Failed to load the Today board" };
  return { ok: true, board };
}

export const todayBoardTools: ToolDefinition[] = [
  {
    schema: {
      name: "get_today_board",
      description: `Get the Today board's content: background and all elements with ids, positions, sizes and data. ${TODAY_BOARD_NOTE}`,
      input_schema: { type: "object", properties: {} },
    },
    isWrite: false,
    category: "today-board",
    execute: async () => {
      const found = await requireTodayBoard();
      if (!found.ok) return { success: false, error: found.error };
      return { success: true, todayBoard: boardSummary(found.board) };
    },
  },
  {
    schema: {
      name: "view_today_board",
      description:
        "Render the Today board to a PNG image and attach it to the tool result so you can see exactly what it looks like. Requires a vision-capable model.",
      input_schema: { type: "object", properties: {} },
    },
    isWrite: false,
    category: "today-board",
    execute: async () => {
      const found = await requireTodayBoard();
      if (!found.ok) return { success: false, error: found.error };
      if (found.board.elements.length === 0) {
        return { success: true, note: "The Today board is empty." };
      }
      return renderBoardImage(found.board);
    },
  },
  {
    schema: {
      name: "add_today_board_elements",
      description: `Add drawing or component elements to the Today board. ${TODAY_BOARD_NOTE} ${ELEMENT_DATA_GUIDE}`,
      input_schema: {
        type: "object",
        properties: {
          elements: {
            type: "array",
            items: { type: "object" },
            description:
              "Elements to add: {type, componentType?, x, y, width?, height?, rotation?, data}. Ids and z-order are assigned automatically.",
          },
        },
        required: ["elements"],
      },
    },
    isWrite: true,
    category: "today-board",
    execute: async (input) => {
      const found = await requireTodayBoard();
      if (!found.ok) return { success: false, error: found.error };
      const built = buildNewElements(
        input.elements,
        maxZIndex(found.board.elements),
      );
      if (!built.ok) return { success: false, error: built.error };
      const updated = await updateTodayBoard({
        elements: [...found.board.elements, ...built.elements],
      });
      if (!updated) {
        return { success: false, error: "Failed to save the Today board" };
      }
      return {
        success: true,
        addedElementIds: built.elements.map((el) => el.id),
        elementCount: updated.elements.length,
      };
    },
  },
  {
    schema: {
      name: "update_today_board_element",
      description:
        "Update one element on the Today board: move (x/y), resize (width/height), rotate (degrees), restack (zIndex), or patch data fields (shallow-merged into existing data).",
      input_schema: {
        type: "object",
        properties: {
          elementId: {
            type: "string",
            description: "The element id from get_today_board.",
          },
          x: { type: "number", description: "New x position." },
          y: { type: "number", description: "New y position." },
          width: { type: "number", description: "New width." },
          height: { type: "number", description: "New height." },
          rotation: { type: "number", description: "Rotation in degrees." },
          zIndex: { type: "number", description: "New stacking order." },
          data: {
            type: "object",
            description: "Data fields to merge into the element's data.",
          },
        },
        required: ["elementId"],
      },
    },
    isWrite: true,
    category: "today-board",
    execute: async (input) => {
      const found = await requireTodayBoard();
      if (!found.ok) return { success: false, error: found.error };
      const element = found.board.elements.find(
        (el) => el.id === input.elementId,
      );
      if (!element) {
        return {
          success: false,
          error: "Element not found. Use get_today_board for element ids.",
        };
      }
      const { elementId: _el, ...patch } = input;
      const applied = applyElementPatch(element, patch);
      if (!applied.ok) return { success: false, error: applied.error };
      const updated = await updateTodayBoard({
        elements: found.board.elements.map((el) =>
          el.id === element.id ? applied.element : el,
        ),
      });
      if (!updated) {
        return { success: false, error: "Failed to save the Today board" };
      }
      return { success: true, element: summarizeElement(applied.element) };
    },
  },
  {
    schema: {
      name: "delete_today_board_elements",
      description: "Delete elements from the Today board by id.",
      input_schema: {
        type: "object",
        properties: {
          elementIds: {
            type: "array",
            items: { type: "string" },
            description: "Element ids from get_today_board.",
          },
        },
        required: ["elementIds"],
      },
    },
    isWrite: true,
    category: "today-board",
    execute: async (input) => {
      const found = await requireTodayBoard();
      if (!found.ok) return { success: false, error: found.error };
      const ids = z.array(z.string()).min(1).safeParse(input.elementIds);
      if (!ids.success) {
        return {
          success: false,
          error: "elementIds must be a non-empty string array",
        };
      }
      const idSet = new Set(ids.data);
      const remaining = found.board.elements.filter((el) => !idSet.has(el.id));
      const removed = found.board.elements.length - remaining.length;
      if (removed === 0) {
        return { success: false, error: "No matching elements found" };
      }
      const updated = await updateTodayBoard({ elements: remaining });
      if (!updated) {
        return { success: false, error: "Failed to save the Today board" };
      }
      return { success: true, removed, elementCount: remaining.length };
    },
  },
  {
    schema: {
      name: "set_today_board_background",
      description:
        "Set the Today board's background color and optional pattern (none, dots, grid, lines). Resets on the nightly clear.",
      input_schema: {
        type: "object",
        properties: {
          color: {
            type: "string",
            description: "Background color as a hex string, e.g. #faf9f6.",
          },
          pattern: {
            type: "string",
            enum: ["none", "dots", "grid", "lines"],
            description: "Optional background pattern.",
          },
        },
        required: ["color"],
      },
    },
    isWrite: true,
    category: "today-board",
    execute: async (input) => {
      const parsed = parseBackground(input);
      if (!parsed.ok) return { success: false, error: parsed.error };
      const updated = await updateTodayBoard({ background: parsed.background });
      if (!updated) {
        return { success: false, error: "Failed to save the Today board" };
      }
      return { success: true, background: updated.background };
    },
  },
];
