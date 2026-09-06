import { z } from "zod";
import { getTodayBoard, updateTodayBoard } from "@/lib/whiteboard";
import type { ILeanWhiteboard } from "@/models/Whiteboard";
import { defineTool } from "./define";
import type { ToolDefinition } from "./types";
import {
  applyComponentItemOps,
  applyElementPatch,
  boardSummary,
  buildNewElements,
  COMPONENT_ITEM_GUIDE,
  ELEMENT_DATA_GUIDE,
  maxZIndex,
  parseBackground,
  renderBoardImage,
  summarizeElement,
} from "./whiteboard";

const TODAY_BOARD_NOTE =
  "The Today board is the daily scratch whiteboard: it is archived to the journal and cleared every night, so it always reflects the current day.";

const elementId = z
  .string()
  .min(1)
  .describe("Element id (a uuid) exactly as get_today_board returned it");

async function requireTodayBoard(): Promise<
  { ok: true; board: ILeanWhiteboard } | { ok: false; error: string }
> {
  const board = await getTodayBoard();
  if (!board) return { ok: false, error: "Failed to load the Today board" };
  return { ok: true, board };
}

/** Every path out of a missing element, so none of them says only "not found". */
function missingElement(id: string) {
  return {
    success: false as const,
    error: `No element on the Today board has id "${id}". Call get_today_board to see the element ids that exist.`,
  };
}

export const todayBoardTools: ToolDefinition[] = [
  defineTool({
    name: "get_today_board",
    description: `Get the Today board's content: background and all elements with ids, positions, sizes and data. ${TODAY_BOARD_NOTE}`,
    isWrite: false,
    category: "today-board",
    input: z.object({}),
    execute: async () => {
      const found = await requireTodayBoard();
      if (!found.ok) return { success: false, error: found.error };
      return { success: true, todayBoard: boardSummary(found.board) };
    },
  }),
  defineTool({
    name: "view_today_board",
    description:
      "Render the Today board to a PNG image and attach it to the tool result so you can see exactly what it looks like. Requires a vision-capable model.",
    isWrite: false,
    category: "today-board",
    input: z.object({}),
    execute: async () => {
      const found = await requireTodayBoard();
      if (!found.ok) return { success: false, error: found.error };
      if (found.board.elements.length === 0) {
        return { success: true, note: "The Today board is empty." };
      }
      return renderBoardImage(found.board);
    },
  }),
  defineTool({
    name: "add_today_board_elements",
    description: `Add drawing or component elements to the Today board. ${TODAY_BOARD_NOTE} ${ELEMENT_DATA_GUIDE}`,
    isWrite: true,
    category: "today-board",
    input: z.object({
      elements: z
        .array(z.record(z.string(), z.unknown()))
        .describe(
          "Elements to add: {type, componentType?, x, y, width?, height?, rotation?, data}. Ids and z-order are assigned automatically.",
        ),
    }),
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
  }),
  defineTool({
    name: "update_today_board_element",
    description:
      "Update one element on the Today board: move (x/y), resize (width/height), rotate (degrees), restack (zIndex), or patch data fields (shallow-merged into existing data).",
    isWrite: true,
    category: "today-board",
    input: z.object({
      elementId,
      x: z.number().optional().describe("New x position in canvas units."),
      y: z.number().optional().describe("New y position in canvas units."),
      width: z.number().optional().describe("New width in canvas units."),
      height: z.number().optional().describe("New height in canvas units."),
      rotation: z.number().optional().describe("Rotation in degrees."),
      zIndex: z
        .number()
        .optional()
        .describe("New stacking order; higher draws on top."),
      data: z
        .record(z.string(), z.unknown())
        .optional()
        .describe("Data fields to merge into the element's data."),
    }),
    execute: async (input) => {
      const found = await requireTodayBoard();
      if (!found.ok) return { success: false, error: found.error };
      const element = found.board.elements.find(
        (el) => el.id === input.elementId,
      );
      if (!element) return missingElement(input.elementId);
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
  }),
  defineTool({
    name: "update_today_board_component_items",
    description: `Add, edit or remove the rows of a list component on the Today board (checklist rows, quick links). ${COMPONENT_ITEM_GUIDE} ${TODAY_BOARD_NOTE}`,
    isWrite: true,
    category: "today-board",
    input: z.object({
      elementId: elementId.describe(
        "Component element id (a uuid) exactly as get_today_board returned it. Must be a todo-list or quick-links component.",
      ),
      add: z
        .array(z.record(z.string(), z.unknown()))
        .optional()
        .describe(
          "Rows to add: {text, completed?} for todo-list, {label, url} for quick-links. completed defaults to false. Ids are assigned automatically.",
        ),
      insertAt: z
        .number()
        .int()
        .min(0)
        .optional()
        .describe(
          "Zero-based index to insert the added rows at. Appends to the end when omitted.",
        ),
      update: z
        .array(z.record(z.string(), z.unknown()))
        .optional()
        .describe(
          "Row patches, each {id, ...fields}: {id, text?, completed?} for todo-list, {id, label?, url?} for quick-links.",
        ),
      remove: z
        .array(z.string())
        .optional()
        .describe("Row ids to delete, as get_today_board returned them."),
    }),
    execute: async (input) => {
      const found = await requireTodayBoard();
      if (!found.ok) return { success: false, error: found.error };
      const element = found.board.elements.find(
        (el) => el.id === input.elementId,
      );
      if (!element) return missingElement(input.elementId);
      const { elementId: _el, ...ops } = input;
      const applied = applyComponentItemOps(element, ops);
      if (!applied.ok) return { success: false, error: applied.error };
      const updated = await updateTodayBoard({
        elements: found.board.elements.map((el) =>
          el.id === element.id ? applied.element : el,
        ),
      });
      if (!updated) {
        return { success: false, error: "Failed to save the Today board" };
      }
      return {
        success: true,
        addedItemIds: applied.addedItemIds,
        updatedItemIds: applied.updatedItemIds,
        removedItemIds: applied.removedItemIds,
        element: summarizeElement(applied.element),
      };
    },
  }),
  defineTool({
    name: "delete_today_board_elements",
    description: "Delete elements from the Today board by id.",
    isWrite: true,
    category: "today-board",
    input: z.object({
      elementIds: z
        .array(elementId)
        .min(1)
        .describe(
          "Element ids (uuids) exactly as get_today_board returned them.",
        ),
    }),
    execute: async (input) => {
      const found = await requireTodayBoard();
      if (!found.ok) return { success: false, error: found.error };
      const idSet = new Set(input.elementIds);
      const remaining = found.board.elements.filter((el) => !idSet.has(el.id));
      const removed = found.board.elements.length - remaining.length;
      if (removed === 0) {
        return {
          success: false,
          error: `No element on the Today board has any of these ids: ${input.elementIds.join(", ")}. Call get_today_board to see the element ids that exist.`,
        };
      }
      const updated = await updateTodayBoard({ elements: remaining });
      if (!updated) {
        return { success: false, error: "Failed to save the Today board" };
      }
      return { success: true, removed, elementCount: remaining.length };
    },
  }),
  defineTool({
    name: "set_today_board_background",
    description:
      "Set the Today board's background color and optional pattern (none, dots, grid, lines). Resets on the nightly clear.",
    isWrite: true,
    category: "today-board",
    input: z.object({
      color: z
        .string()
        .describe("Background color as a hex string, e.g. #faf9f6."),
      pattern: z
        .enum(["none", "dots", "grid", "lines"])
        .optional()
        .describe("Background pattern. Defaults to the board's current one."),
    }),
    execute: async (input) => {
      const parsed = parseBackground(input);
      if (!parsed.ok) return { success: false, error: parsed.error };
      const updated = await updateTodayBoard({ background: parsed.background });
      if (!updated) {
        return { success: false, error: "Failed to save the Today board" };
      }
      return { success: true, background: updated.background };
    },
  }),
];
