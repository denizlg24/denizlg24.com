import {
  type Block,
  type BlockOf,
  type BlockType,
  HOME_PAGE_ID,
  moduleRef,
  SIDEBAR_DEFAULT_WIDTH,
  type Workspace,
  type WorkspacePage,
} from "@repo/schemas";
import {
  MODULE_SECTIONS,
  type ModuleId,
  type ModuleSectionId,
} from "./modules";

export function newId(): string {
  return crypto.randomUUID().replace(/-/g, "").slice(0, 12);
}

/** A fresh, empty block of `type`. */
export function createBlock(type: BlockType): Block {
  const id = newId();
  switch (type) {
    case "paragraph":
      return { id, type, text: [] };
    case "heading":
      return { id, type, level: 2, text: [] };
    case "bullet":
    case "numbered":
    case "quote":
      return { id, type, text: [], children: [] };
    case "todo":
      return { id, type, text: [], checked: false, children: [] };
    case "toggle":
      return { id, type, text: [], children: [] };
    case "callout":
      return {
        id,
        type,
        text: [],
        emoji: "💡",
        color: "default",
        children: [],
      };
    case "code":
      return { id, type, code: "", language: "" };
    case "image":
      return { id, type, url: "", caption: [] };
    case "file":
      return { id, type, url: "", name: "" };
    case "bookmark":
      return { id, type, url: "" };
    case "equation":
      return { id, type, expression: "" };
    case "table":
      return {
        id,
        type,
        headerRow: true,
        rows: [
          [[], []],
          [[], []],
        ],
      };
    case "synced":
      return { id, type, pageId: "", blockId: "" };
    case "columns":
      return {
        id,
        type,
        children: [createColumn(0.5), createColumn(0.5)],
      };
    case "column":
      return createColumn(1);
    case "links":
      return { id, type, refs: [] };
    case "modules":
      return { id, type, sections: [] };
    case "record":
      return { id, type, ref: "", mode: "card" };
    case "view":
      return {
        id,
        type,
        source: "kanban-cards",
        layout: "table",
        filters: [],
        sort: [],
        limit: 25,
      };
    case "divider":
    case "toc":
    case "breadcrumb":
    case "subpages":
    case "greeting":
    case "stats":
    case "agenda":
    case "tasks":
    case "semester":
    case "alerts":
    case "budget":
    case "resources":
    case "llm":
    case "notes":
    case "contacts":
    case "now":
    case "board":
    case "agent":
      return { id, type };
  }
}

function createColumn(
  width: number,
  children: Block[] = [],
): BlockOf<"column"> {
  return { id: newId(), type: "column", width, children };
}

/** Blocks side by side, each as wide as its share of `shares`. */
function row(...cells: [number, Block][]): Block {
  const total = cells.reduce((sum, [share]) => sum + share, 0);
  return {
    id: newId(),
    type: "columns",
    children: cells.map(([share, block]) =>
      createColumn(share / total, [block]),
    ),
  };
}

function page(
  id: string,
  title: string,
  icon: string,
  parentId: string | null,
  order: number,
  blocks: Block[],
  now: string,
): WorkspacePage {
  return {
    id,
    title,
    icon,
    parentId,
    order,
    blocks,
    fullWidth: false,
    locked: false,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  };
}

function links(ids: ModuleId[], title?: string): Block {
  return {
    id: newId(),
    type: "links",
    refs: ids.map(moduleRef),
    ...(title ? { title } : {}),
  };
}

function modulesBlock(sections: ModuleSectionId[], title?: string): Block {
  return {
    id: newId(),
    type: "modules",
    sections,
    ...(title ? { title } : {}),
  };
}

/**
 * The workspace a first launch opens on: Home carries every live summary the
 * old dashboard showed plus an index of every module, and three sub-pages
 * group the rest by area so the tree is useful from the start.
 */
export function seedWorkspace(): Workspace {
  const now = new Date().toISOString();
  const b = createBlock;

  const home = page(
    HOME_PAGE_ID,
    "Home",
    "🌿",
    null,
    0,
    [
      b("greeting"),
      b("stats"),
      row([1, b("agenda")], [1, b("tasks")]),
      row([1, b("semester")], [1, b("alerts")], [1, b("budget")]),
      row([1, b("now")], [1, b("board")], [1, b("notes")]),
      row([1, b("contacts")], [1, b("resources")]),
      b("agent"),
      modulesBlock([], "Everything"),
    ],
    now,
  );

  const school = page(
    newId(),
    "School",
    "🎓",
    HOME_PAGE_ID,
    0,
    [
      row([1, b("semester")], [1, b("agenda")]),
      row([1, b("tasks")], [1, b("todo")]),
      links(["courses", "timetable", "calendar", "papers", "latex", "notes"]),
    ],
    now,
  );

  const money = page(
    newId(),
    "Money",
    "💶",
    HOME_PAGE_ID,
    1,
    [
      row([1, b("budget")], [2, b("alerts")]),
      links([
        "finance",
        "budget",
        "hours",
        "markets",
        "portfolios",
        "holdings",
      ]),
    ],
    now,
  );

  const systems = page(
    newId(),
    "Systems",
    "🛰️",
    HOME_PAGE_ID,
    2,
    [row([1, b("resources")], [1, b("llm")]), modulesBlock(["system"])],
    now,
  );

  return {
    version: 2,
    pages: {
      [home.id]: home,
      [school.id]: school,
      [money.id]: money,
      [systems.id]: systems,
    },
    favorites: [moduleRef("inbox"), moduleRef("calendar"), moduleRef("kanban")],
    recents: [],
    sidebar: {
      width: SIDEBAR_DEFAULT_WIDTH,
      collapsed: false,
      hiddenModules: [],
      collapsedSections: MODULE_SECTIONS.filter(
        (s) => s.id === "portfolio" || s.id === "system",
      ).map((s) => s.id),
      expandedPages: [HOME_PAGE_ID],
    },
  };
}
