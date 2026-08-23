import { randomUUID } from "node:crypto";
import {
  componentTypeSchema,
  type IWhiteboardBackground,
  type IWhiteboardElement,
  validateWhiteboardElement,
  whiteboardBackgroundSchema,
  whiteboardElementKind,
} from "@repo/schemas";
import {
  COMPONENT_DEFAULT_SIZES,
  elementBounds,
  TEXT_LINE_HEIGHT,
  todoListHeight,
  wrapText,
} from "@repo/whiteboard-render";
import { z } from "zod";
import {
  createWhiteboard as createWhiteboardDoc,
  getAllWhiteboards,
  getWhiteboardById,
  updateWhiteboard,
} from "@/lib/whiteboard";
import type { ILeanWhiteboard } from "@/models/Whiteboard";
import type { ToolDefinition, ToolImageResult } from "./types";

export const ELEMENT_DATA_GUIDE = `Element formats (canvas coords: +x right, +y down; a typical screen shows ~1400x900):
- Freehand stroke: type "drawing", data {points:[{x,y},...] relative to element x/y, color:"#hex", thickness:number, brush?:"pen"|"highlighter"}.
- Shape: type "drawing", data {shapeType:"rectangle"|"square"|"circle"|"arrow"|"line", color:"#hex", thickness:number, fill?:"#hex"}; rectangle/square/circle need element width/height; arrow/line use data.x2/data.y2 as the endpoint relative to element x/y.
- Text: type "drawing", data {text, color:"#hex", fontSize:number, fontWeight?:400|500|700, fontFamily?:"handwriting"|"sans"|"serif"|"mono", align?:"left"|"center"|"right"}; element width sets the wrap width (height auto-computed when omitted). Default font is handwriting (Excalifont).
- Image: type "drawing", data {src:"https url"}, element width/height.
- Component: type "component" with componentType and data — "todo-list" {title?, items:[{text, completed}]}, "sticky-note" {content, colorIndex:0-5}, "quick-links" {title, links:[{label, url}]}, "markdown-note" {content}, "pdf-viewer" {pdfUrl?, fileName?}. Sizes default sensibly when width/height omitted.
- A "todo-list" renders as a bare checklist — one 24px square box and a 20px line of text per row, 42px apart, no card around it. Omit the title for an untitled list. Height roughly 30 (only with a title) + 42 per row + 34 for the add-row affordance.
- To change the rows of an existing todo-list or quick-links, prefer the component-items tool over patching the whole array through the element data.`;

const newElementSchema = z.object({
  type: z.enum(["drawing", "component"]),
  componentType: componentTypeSchema.optional(),
  x: z.number(),
  y: z.number(),
  width: z.number().positive().optional(),
  height: z.number().positive().optional(),
  rotation: z.number().optional(),
  data: z.record(z.string(), z.unknown()),
});

const elementPatchSchema = z.object({
  x: z.number().optional(),
  y: z.number().optional(),
  width: z.number().positive().optional(),
  height: z.number().positive().optional(),
  rotation: z.number().optional(),
  zIndex: z.number().optional(),
  data: z.record(z.string(), z.unknown()).optional(),
});

function withGeneratedItemIds(
  componentType: string | undefined,
  data: Record<string, unknown>,
): Record<string, unknown> {
  const key =
    componentType === "todo-list"
      ? "items"
      : componentType === "quick-links"
        ? "links"
        : null;
  if (!key || !Array.isArray(data[key])) return data;
  return {
    ...data,
    [key]: data[key].map((item) =>
      typeof item === "object" && item !== null && !("id" in item)
        ? { id: randomUUID(), ...item }
        : item,
    ),
  };
}

function defaultTextHeight(data: Record<string, unknown>, width: number) {
  const text = typeof data.text === "string" ? data.text : "";
  const fontSize = typeof data.fontSize === "number" ? data.fontSize : 16;
  const family =
    data.fontFamily === "sans" ||
    data.fontFamily === "serif" ||
    data.fontFamily === "mono"
      ? data.fontFamily
      : "handwriting";
  const weight = typeof data.fontWeight === "number" ? data.fontWeight : 400;
  const lines = wrapText(text, width - 4, fontSize, family, weight);
  return Math.ceil(lines.length * fontSize * TEXT_LINE_HEIGHT) + 8;
}

export function buildNewElements(
  input: unknown,
  maxZIndex: number,
): { ok: true; elements: IWhiteboardElement[] } | { ok: false; error: string } {
  const parsed = z.array(newElementSchema).min(1).safeParse(input);
  if (!parsed.success)
    return { ok: false, error: z.prettifyError(parsed.error) };

  const elements: IWhiteboardElement[] = [];
  for (const [index, item] of parsed.data.entries()) {
    const element: IWhiteboardElement = {
      id: randomUUID(),
      zIndex: maxZIndex + index + 1,
      ...item,
      data: withGeneratedItemIds(item.componentType, item.data),
    };

    if (element.type === "component" && element.componentType) {
      const defaults = COMPONENT_DEFAULT_SIZES[element.componentType];
      if (defaults) {
        element.width ??= defaults.width;
        element.height ??= defaults.height;
      }
      if (element.componentType === "todo-list") {
        element.height = todoListHeight(
          Array.isArray(element.data.items) ? element.data.items.length : 0,
          typeof element.data.title === "string" &&
            element.data.title.length > 0,
        );
      }
    }
    const kind = whiteboardElementKind(element);
    if (kind === "text") {
      element.width ??= 260;
      element.height ??= defaultTextHeight(element.data, element.width);
    } else if (kind === "image") {
      element.width ??= 240;
      element.height ??= 240;
    } else if (kind === "shape") {
      const shapeType = element.data.shapeType;
      if (shapeType !== "arrow" && shapeType !== "line") {
        element.width ??= 160;
        element.height ??= 120;
      } else {
        element.data = {
          x2: 120,
          y2: 0,
          ...element.data,
        };
      }
    }

    const check = validateWhiteboardElement(element);
    if (!check.ok) {
      return { ok: false, error: `elements[${index}]: ${check.error}` };
    }
    elements.push(element);
  }
  return { ok: true, elements };
}

export function applyElementPatch(
  element: IWhiteboardElement,
  patch: unknown,
): { ok: true; element: IWhiteboardElement } | { ok: false; error: string } {
  const parsed = elementPatchSchema.safeParse(patch);
  if (!parsed.success)
    return { ok: false, error: z.prettifyError(parsed.error) };
  const { data, ...rest } = parsed.data;
  const updated: IWhiteboardElement = {
    ...element,
    ...rest,
    data: data
      ? withGeneratedItemIds(element.componentType, {
          ...element.data,
          ...data,
        })
      : element.data,
  };
  const check = validateWhiteboardElement(updated);
  if (!check.ok) return { ok: false, error: check.error };
  return { ok: true, element: updated };
}

/** Components whose data carries an editable list, and the key it lives under. */
const COMPONENT_ITEM_KEYS: Record<string, string> = {
  "todo-list": "items",
  "quick-links": "links",
};

export const COMPONENT_ITEM_GUIDE =
  'Edit the rows of a list component in place instead of resending the whole array through element data: "todo-list" edits data.items ({text, completed}) and "quick-links" edits data.links ({label, url}). Item ids come from get_whiteboard/get_today_board; added rows get an id automatically. Operations apply in one write, in the order update, remove, add.';

const componentItemOpsSchema = z.object({
  add: z.array(z.record(z.string(), z.unknown())).optional(),
  insertAt: z.number().int().nonnegative().optional(),
  update: z.array(z.record(z.string(), z.unknown())).optional(),
  remove: z.array(z.string()).optional(),
});

interface ComponentItem extends Record<string, unknown> {
  id: string;
}

function isComponentItem(value: unknown): value is ComponentItem {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { id?: unknown }).id === "string"
  );
}

export function applyComponentItemOps(
  element: IWhiteboardElement,
  ops: unknown,
):
  | {
      ok: true;
      element: IWhiteboardElement;
      addedItemIds: string[];
      updatedItemIds: string[];
      removedItemIds: string[];
    }
  | { ok: false; error: string } {
  const key = element.componentType
    ? COMPONENT_ITEM_KEYS[element.componentType]
    : undefined;
  if (!key) {
    return {
      ok: false,
      error: `Element ${element.id} is not a list component. Editable list components: ${Object.keys(COMPONENT_ITEM_KEYS).join(", ")}.`,
    };
  }
  const parsed = componentItemOpsSchema.safeParse(ops);
  if (!parsed.success) {
    return { ok: false, error: z.prettifyError(parsed.error) };
  }
  const { add, insertAt, update, remove } = parsed.data;
  if (!add?.length && !update?.length && !remove?.length) {
    return { ok: false, error: "Nothing to do: pass add, update or remove." };
  }

  const existing = Array.isArray(element.data[key])
    ? (element.data[key] as unknown[]).filter(isComponentItem)
    : [];
  let items: ComponentItem[] = existing.map((item) => ({ ...item }));

  const updatedItemIds: string[] = [];
  const missing: string[] = [];
  for (const patch of update ?? []) {
    const { id, ...fields } = patch;
    if (typeof id !== "string") {
      return { ok: false, error: "Each update entry needs the item's id." };
    }
    const index = items.findIndex((item) => item.id === id);
    if (index === -1) {
      missing.push(id);
      continue;
    }
    items[index] = { ...items[index], ...fields, id };
    updatedItemIds.push(id);
  }

  const removedItemIds: string[] = [];
  for (const id of remove ?? []) {
    if (!items.some((item) => item.id === id)) {
      missing.push(id);
      continue;
    }
    removedItemIds.push(id);
  }
  items = items.filter((item) => !removedItemIds.includes(item.id));

  if (missing.length > 0) {
    return {
      ok: false,
      error: `No such item id on element ${element.id}: ${[...new Set(missing)].join(", ")}. Re-read the board for current item ids.`,
    };
  }

  const added: ComponentItem[] = (add ?? []).map((item) => ({
    ...(key === "items" ? { completed: false } : {}),
    ...item,
    id: randomUUID(),
  }));
  const at =
    insertAt === undefined ? items.length : Math.min(insertAt, items.length);
  items = [...items.slice(0, at), ...added, ...items.slice(at)];

  const updated: IWhiteboardElement = {
    ...element,
    data: { ...element.data, [key]: items },
  };
  // A checklist's height is its row count. The editor keeps the box in step on
  // every edit; a tool write has to do the same or the rendered board clips the
  // rows the agent just added.
  if (element.componentType === "todo-list") {
    updated.height = todoListHeight(
      items.length,
      typeof updated.data.title === "string" && updated.data.title.length > 0,
    );
  }
  const check = validateWhiteboardElement(updated);
  if (!check.ok) return { ok: false, error: check.error };
  return {
    ok: true,
    element: updated,
    addedItemIds: added.map((item) => item.id),
    updatedItemIds,
    removedItemIds,
  };
}

export function summarizeElement(element: IWhiteboardElement) {
  const kind = whiteboardElementKind(element);
  const base = {
    id: element.id,
    kind,
    x: element.x,
    y: element.y,
    width: element.width,
    height: element.height,
    rotation: element.rotation,
    zIndex: element.zIndex,
  };
  if (kind === "pen") {
    const points = Array.isArray(element.data.points)
      ? element.data.points.length
      : 0;
    const bounds = elementBounds(element);
    return {
      ...base,
      color: element.data.color,
      thickness: element.data.thickness,
      brush: element.data.brush ?? "pen",
      pointCount: points,
      bounds,
    };
  }
  return {
    ...base,
    ...(element.componentType ? { componentType: element.componentType } : {}),
    data: element.data,
  };
}

const MAX_LISTED_ELEMENTS = 200;

export function boardSummary(board: ILeanWhiteboard) {
  return {
    _id: board._id,
    name: board.name,
    background: board.background ?? null,
    elementCount: board.elements.length,
    elements: board.elements
      .slice(0, MAX_LISTED_ELEMENTS)
      .map(summarizeElement),
    ...(board.elements.length > MAX_LISTED_ELEMENTS
      ? { truncated: `showing first ${MAX_LISTED_ELEMENTS} elements` }
      : {}),
  };
}

export function maxZIndex(elements: IWhiteboardElement[]): number {
  return elements.reduce((max, el) => Math.max(max, el.zIndex), 0);
}

export async function renderBoardImage(
  board: ILeanWhiteboard,
): Promise<ToolImageResult> {
  const { renderWhiteboardPng } = await import("@/lib/whiteboard-image");
  const { png, width, height } = await renderWhiteboardPng(
    board.elements,
    board.background,
  );
  return {
    kind: "tool-image",
    mediaType: "image/png",
    base64: png.toString("base64"),
    summary: {
      success: true,
      name: board.name,
      elementCount: board.elements.length,
      imageWidth: width,
      imageHeight: height,
    },
  };
}

export const backgroundInputSchema = z.object({
  color: z.string(),
  pattern: z.enum(["none", "dots", "grid", "lines"]).optional(),
});

export function parseBackground(
  input: Record<string, unknown>,
):
  | { ok: true; background: IWhiteboardBackground }
  | { ok: false; error: string } {
  const parsed = whiteboardBackgroundSchema.safeParse({
    color: input.color,
    ...(input.pattern !== undefined ? { pattern: input.pattern } : {}),
  });
  if (!parsed.success)
    return { ok: false, error: z.prettifyError(parsed.error) };
  return { ok: true, background: parsed.data };
}

async function requireBoard(
  whiteboardId: unknown,
): Promise<
  { ok: true; board: ILeanWhiteboard } | { ok: false; error: string }
> {
  if (typeof whiteboardId !== "string" || whiteboardId.length === 0) {
    return { ok: false, error: "whiteboardId is required" };
  }
  const board = await getWhiteboardById(whiteboardId);
  if (!board) {
    return {
      ok: false,
      error: "Whiteboard not found. Use list_whiteboards to get valid ids.",
    };
  }
  return { ok: true, board };
}

export const whiteboardTools: ToolDefinition[] = [
  {
    schema: {
      name: "list_whiteboards",
      description:
        "List all saved whiteboards (name, id, timestamps). The daily 'Today' board is separate — use the today_board tools for it.",
      input_schema: { type: "object", properties: {} },
    },
    isWrite: false,
    category: "whiteboard",
    execute: async () => {
      const whiteboards = await getAllWhiteboards();
      return { success: true, whiteboards };
    },
  },
  {
    schema: {
      name: "get_whiteboard",
      description:
        "Get a whiteboard's content: background and all elements with ids, positions, sizes and data (freehand strokes are summarized with bounds instead of full point lists). Use the element ids with update_whiteboard_element / delete_whiteboard_elements.",
      input_schema: {
        type: "object",
        properties: {
          whiteboardId: {
            type: "string",
            description: "The whiteboard _id from list_whiteboards.",
          },
        },
        required: ["whiteboardId"],
      },
    },
    isWrite: false,
    category: "whiteboard",
    execute: async (input) => {
      const found = await requireBoard(input.whiteboardId);
      if (!found.ok) return { success: false, error: found.error };
      return { success: true, whiteboard: boardSummary(found.board) };
    },
  },
  {
    schema: {
      name: "view_whiteboard",
      description:
        "Render a whiteboard to a PNG image and attach it to the tool result so you can see exactly what the board looks like. Requires a vision-capable model.",
      input_schema: {
        type: "object",
        properties: {
          whiteboardId: {
            type: "string",
            description: "The whiteboard _id from list_whiteboards.",
          },
        },
        required: ["whiteboardId"],
      },
    },
    isWrite: false,
    category: "whiteboard",
    execute: async (input) => {
      const found = await requireBoard(input.whiteboardId);
      if (!found.ok) return { success: false, error: found.error };
      if (found.board.elements.length === 0) {
        return { success: true, note: "The whiteboard is empty." };
      }
      return renderBoardImage(found.board);
    },
  },
  {
    schema: {
      name: "create_whiteboard",
      description: "Create a new empty whiteboard.",
      input_schema: {
        type: "object",
        properties: {
          name: { type: "string", description: "Name for the whiteboard." },
        },
        required: ["name"],
      },
    },
    isWrite: true,
    category: "whiteboard",
    execute: async (input) => {
      if (typeof input.name !== "string" || input.name.trim() === "") {
        return { success: false, error: "name is required" };
      }
      const board = await createWhiteboardDoc({ name: input.name.trim() });
      if (!board)
        return { success: false, error: "Failed to create whiteboard" };
      return {
        success: true,
        whiteboard: { _id: board._id, name: board.name },
      };
    },
  },
  {
    schema: {
      name: "add_whiteboard_elements",
      description: `Add drawing or component elements to a whiteboard. ${ELEMENT_DATA_GUIDE}`,
      input_schema: {
        type: "object",
        properties: {
          whiteboardId: {
            type: "string",
            description: "The whiteboard _id from list_whiteboards.",
          },
          elements: {
            type: "array",
            items: { type: "object" },
            description:
              "Elements to add: {type, componentType?, x, y, width?, height?, rotation?, data}. Ids and z-order are assigned automatically.",
          },
        },
        required: ["whiteboardId", "elements"],
      },
    },
    isWrite: true,
    category: "whiteboard",
    execute: async (input) => {
      const found = await requireBoard(input.whiteboardId);
      if (!found.ok) return { success: false, error: found.error };
      const built = buildNewElements(
        input.elements,
        maxZIndex(found.board.elements),
      );
      if (!built.ok) return { success: false, error: built.error };
      const updated = await updateWhiteboard(found.board._id, {
        elements: [...found.board.elements, ...built.elements],
      });
      if (!updated)
        return { success: false, error: "Failed to save whiteboard" };
      return {
        success: true,
        addedElementIds: built.elements.map((el) => el.id),
        elementCount: updated.elements.length,
      };
    },
  },
  {
    schema: {
      name: "update_whiteboard_element",
      description:
        "Update one element on a whiteboard: move (x/y), resize (width/height), rotate (degrees), restack (zIndex), or patch data fields (shallow-merged into existing data; e.g. change text, color, fill, todo items).",
      input_schema: {
        type: "object",
        properties: {
          whiteboardId: {
            type: "string",
            description: "The whiteboard _id from list_whiteboards.",
          },
          elementId: {
            type: "string",
            description: "The element id from get_whiteboard.",
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
        required: ["whiteboardId", "elementId"],
      },
    },
    isWrite: true,
    category: "whiteboard",
    execute: async (input) => {
      const found = await requireBoard(input.whiteboardId);
      if (!found.ok) return { success: false, error: found.error };
      const element = found.board.elements.find(
        (el) => el.id === input.elementId,
      );
      if (!element) {
        return {
          success: false,
          error: "Element not found. Use get_whiteboard for element ids.",
        };
      }
      const { whiteboardId: _id, elementId: _el, ...patch } = input;
      const applied = applyElementPatch(element, patch);
      if (!applied.ok) return { success: false, error: applied.error };
      const updated = await updateWhiteboard(found.board._id, {
        elements: found.board.elements.map((el) =>
          el.id === element.id ? applied.element : el,
        ),
      });
      if (!updated)
        return { success: false, error: "Failed to save whiteboard" };
      return { success: true, element: summarizeElement(applied.element) };
    },
  },
  {
    schema: {
      name: "update_whiteboard_component_items",
      description: `Add, edit or remove the rows of a list component on a whiteboard (checklist rows, quick links). ${COMPONENT_ITEM_GUIDE}`,
      input_schema: {
        type: "object",
        properties: {
          whiteboardId: {
            type: "string",
            description: "The whiteboard _id from list_whiteboards.",
          },
          elementId: {
            type: "string",
            description:
              "The component element id from get_whiteboard. Must be a todo-list or quick-links component.",
          },
          add: {
            type: "array",
            items: { type: "object" },
            description:
              "Rows to add: {text, completed?} for todo-list, {label, url} for quick-links. completed defaults to false. Ids are assigned automatically.",
          },
          insertAt: {
            type: "number",
            description:
              "Index to insert the added rows at. Appends to the end when omitted.",
            minimum: 0,
          },
          update: {
            type: "array",
            items: { type: "object" },
            description:
              "Row patches, each {id, ...fields}: {id, text?, completed?} for todo-list, {id, label?, url?} for quick-links.",
          },
          remove: {
            type: "array",
            items: { type: "string" },
            description: "Row ids to delete.",
          },
        },
        required: ["whiteboardId", "elementId"],
      },
    },
    isWrite: true,
    category: "whiteboard",
    execute: async (input) => {
      const found = await requireBoard(input.whiteboardId);
      if (!found.ok) return { success: false, error: found.error };
      const element = found.board.elements.find(
        (el) => el.id === input.elementId,
      );
      if (!element) {
        return {
          success: false,
          error: "Element not found. Use get_whiteboard for element ids.",
        };
      }
      const { whiteboardId: _id, elementId: _el, ...ops } = input;
      const applied = applyComponentItemOps(element, ops);
      if (!applied.ok) return { success: false, error: applied.error };
      const updated = await updateWhiteboard(found.board._id, {
        elements: found.board.elements.map((el) =>
          el.id === element.id ? applied.element : el,
        ),
      });
      if (!updated)
        return { success: false, error: "Failed to save whiteboard" };
      return {
        success: true,
        addedItemIds: applied.addedItemIds,
        updatedItemIds: applied.updatedItemIds,
        removedItemIds: applied.removedItemIds,
        element: summarizeElement(applied.element),
      };
    },
  },
  {
    schema: {
      name: "delete_whiteboard_elements",
      description: "Delete elements from a whiteboard by id.",
      input_schema: {
        type: "object",
        properties: {
          whiteboardId: {
            type: "string",
            description: "The whiteboard _id from list_whiteboards.",
          },
          elementIds: {
            type: "array",
            items: { type: "string" },
            description: "Element ids from get_whiteboard.",
          },
        },
        required: ["whiteboardId", "elementIds"],
      },
    },
    isWrite: true,
    category: "whiteboard",
    execute: async (input) => {
      const found = await requireBoard(input.whiteboardId);
      if (!found.ok) return { success: false, error: found.error };
      const ids = z.array(z.string()).min(1).safeParse(input.elementIds);
      if (!ids.success)
        return {
          success: false,
          error: "elementIds must be a non-empty string array",
        };
      const idSet = new Set(ids.data);
      const remaining = found.board.elements.filter((el) => !idSet.has(el.id));
      const removed = found.board.elements.length - remaining.length;
      if (removed === 0) {
        return { success: false, error: "No matching elements found" };
      }
      const updated = await updateWhiteboard(found.board._id, {
        elements: remaining,
      });
      if (!updated)
        return { success: false, error: "Failed to save whiteboard" };
      return { success: true, removed, elementCount: remaining.length };
    },
  },
  {
    schema: {
      name: "set_whiteboard_background",
      description:
        "Set a whiteboard's background color and optional pattern (none, dots, grid, lines).",
      input_schema: {
        type: "object",
        properties: {
          whiteboardId: {
            type: "string",
            description: "The whiteboard _id from list_whiteboards.",
          },
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
        required: ["whiteboardId", "color"],
      },
    },
    isWrite: true,
    category: "whiteboard",
    execute: async (input) => {
      const found = await requireBoard(input.whiteboardId);
      if (!found.ok) return { success: false, error: found.error };
      const parsed = parseBackground(input);
      if (!parsed.ok) return { success: false, error: parsed.error };
      const updated = await updateWhiteboard(found.board._id, {
        background: parsed.background,
      });
      if (!updated)
        return { success: false, error: "Failed to save whiteboard" };
      return { success: true, background: updated.background };
    },
  },
];
