import { randomUUID } from "node:crypto";
import {
  type IWhiteboardElement,
  validateWhiteboardElement,
  type WhiteboardComponentItemOps,
  type WhiteboardElementPatch,
  type WhiteboardNewElement,
  whiteboardElementKind,
} from "@repo/schemas";
import {
  COMPONENT_DEFAULT_SIZES,
  elementBounds,
  TEXT_LINE_HEIGHT,
  todoListHeight,
  wrapText,
} from "@repo/whiteboard-render";
import {
  getTodayBoard,
  getWhiteboardById,
  updateTodayBoard,
  updateWhiteboard,
} from "@/lib/whiteboard";
import type { ILeanWhiteboard } from "@/models/Whiteboard";

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

export function maxZIndex(elements: IWhiteboardElement[]): number {
  return elements.reduce((max, el) => Math.max(max, el.zIndex), 0);
}

export function buildNewElements(
  items: WhiteboardNewElement[],
  maxZ: number,
): { ok: true; elements: IWhiteboardElement[] } | { ok: false; error: string } {
  const elements: IWhiteboardElement[] = [];
  for (const [index, item] of items.entries()) {
    const element: IWhiteboardElement = {
      id: randomUUID(),
      zIndex: maxZ + index + 1,
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
        element.data = { x2: 120, y2: 0, ...element.data };
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
  patch: WhiteboardElementPatch,
): { ok: true; element: IWhiteboardElement } | { ok: false; error: string } {
  const { data, ...rest } = patch;
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
  ops: WhiteboardComponentItemOps,
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
  const { add, insertAt, update, remove } = ops;
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
  // A checklist's height is its row count; the editor keeps the box in step
  // on every edit, so a server-side write has to as well or the rendered
  // board clips the rows just added.
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
    return {
      ...base,
      color: element.data.color,
      thickness: element.data.thickness,
      brush: element.data.brush ?? "pen",
      pointCount: points,
      bounds: elementBounds(element),
    };
  }
  return {
    ...base,
    ...(element.componentType ? { componentType: element.componentType } : {}),
    data: element.data,
  };
}

/** One board's load/save pair, so the same mutations serve any board and Today. */
export interface BoardStore {
  load(): Promise<ILeanWhiteboard | null>;
  save(elements: IWhiteboardElement[]): Promise<ILeanWhiteboard | null>;
}

export function boardStore(id: string): BoardStore {
  return {
    load: () => getWhiteboardById(id),
    save: (elements) => updateWhiteboard(id, { elements }),
  };
}

export const todayBoardStore: BoardStore = {
  load: async () => (await getTodayBoard()) ?? null,
  save: (elements) => updateTodayBoard({ elements }),
};

export interface BoardMutation {
  status: number;
  body: Record<string, unknown>;
}

const NOT_FOUND: BoardMutation = {
  status: 404,
  body: { error: "Whiteboard not found" },
};
const SAVE_FAILED: BoardMutation = {
  status: 500,
  body: { error: "Failed to save whiteboard" },
};

function missingElement(board: ILeanWhiteboard, id: string): BoardMutation {
  return {
    status: 404,
    body: { error: `No element with id "${id}" on whiteboard "${board.name}"` },
  };
}

export async function addBoardElements(
  store: BoardStore,
  items: WhiteboardNewElement[],
): Promise<BoardMutation> {
  const board = await store.load();
  if (!board) return NOT_FOUND;
  const built = buildNewElements(items, maxZIndex(board.elements));
  if (!built.ok) return { status: 400, body: { error: built.error } };
  const updated = await store.save([...board.elements, ...built.elements]);
  if (!updated) return SAVE_FAILED;
  return {
    status: 200,
    body: {
      addedElementIds: built.elements.map((el) => el.id),
      elementCount: updated.elements.length,
    },
  };
}

export async function patchBoardElement(
  store: BoardStore,
  elementId: string,
  patch: WhiteboardElementPatch,
): Promise<BoardMutation> {
  const board = await store.load();
  if (!board) return NOT_FOUND;
  const element = board.elements.find((el) => el.id === elementId);
  if (!element) return missingElement(board, elementId);
  const applied = applyElementPatch(element, patch);
  if (!applied.ok) return { status: 400, body: { error: applied.error } };
  const updated = await store.save(
    board.elements.map((el) => (el.id === elementId ? applied.element : el)),
  );
  if (!updated) return SAVE_FAILED;
  return { status: 200, body: { element: summarizeElement(applied.element) } };
}

export async function editBoardComponentItems(
  store: BoardStore,
  elementId: string,
  ops: WhiteboardComponentItemOps,
): Promise<BoardMutation> {
  const board = await store.load();
  if (!board) return NOT_FOUND;
  const element = board.elements.find((el) => el.id === elementId);
  if (!element) return missingElement(board, elementId);
  const applied = applyComponentItemOps(element, ops);
  if (!applied.ok) return { status: 400, body: { error: applied.error } };
  const updated = await store.save(
    board.elements.map((el) => (el.id === elementId ? applied.element : el)),
  );
  if (!updated) return SAVE_FAILED;
  return {
    status: 200,
    body: {
      addedItemIds: applied.addedItemIds,
      updatedItemIds: applied.updatedItemIds,
      removedItemIds: applied.removedItemIds,
      element: summarizeElement(applied.element),
    },
  };
}

export async function removeBoardElements(
  store: BoardStore,
  elementIds: string[],
): Promise<BoardMutation> {
  const board = await store.load();
  if (!board) return NOT_FOUND;
  const idSet = new Set(elementIds);
  const remaining = board.elements.filter((el) => !idSet.has(el.id));
  const removed = board.elements.length - remaining.length;
  if (removed === 0) {
    return {
      status: 404,
      body: {
        error: `None of those ids are on whiteboard "${board.name}": ${elementIds.join(", ")}`,
      },
    };
  }
  const updated = await store.save(remaining);
  if (!updated) return SAVE_FAILED;
  return { status: 200, body: { removed, elementCount: remaining.length } };
}

export async function renderBoard(store: BoardStore): Promise<
  | {
      ok: true;
      empty: false;
      png: Buffer;
      width: number;
      height: number;
      name: string;
    }
  | { ok: true; empty: true; name: string }
  | { ok: false; status: number; error: string }
> {
  const board = await store.load();
  if (!board) return { ok: false, status: 404, error: "Whiteboard not found" };
  if (board.elements.length === 0) {
    return { ok: true, empty: true, name: board.name };
  }
  const { renderWhiteboardPng } = await import("@/lib/whiteboard-image");
  const { png, width, height } = await renderWhiteboardPng(
    board.elements,
    board.background,
  );
  return { ok: true, empty: false, png, width, height, name: board.name };
}
