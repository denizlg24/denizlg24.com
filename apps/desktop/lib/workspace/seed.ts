import { MODULE_SECTIONS, type ModuleSectionId } from "./modules";
import {
  type Block,
  type BlockSpan,
  type BlockType,
  HOME_PAGE_ID,
  moduleRef,
  SIDEBAR_DEFAULT_WIDTH,
  type Workspace,
  type WorkspacePage,
} from "./schema";

export function newId(): string {
  return crypto.randomUUID().replace(/-/g, "").slice(0, 12);
}

const DEFAULT_SPAN: Record<BlockType, BlockSpan> = {
  heading: 6,
  text: 6,
  divider: 6,
  todo: 3,
  links: 6,
  subpages: 6,
  greeting: 6,
  stats: 6,
  agenda: 3,
  tasks: 3,
  semester: 3,
  alerts: 3,
  budget: 2,
  resources: 2,
  llm: 2,
  notes: 3,
  contacts: 3,
  now: 2,
  board: 3,
  agent: 6,
  modules: 6,
};

/** A fresh block of `type` with its default size and empty content. */
export function createBlock(type: BlockType, span?: BlockSpan): Block {
  const id = newId();
  const s = span ?? DEFAULT_SPAN[type];
  switch (type) {
    case "heading":
      return { id, type, span: s, text: "Heading" };
    case "text":
      return { id, type, span: s, markdown: "" };
    case "todo":
      return { id, type, span: s, items: [] };
    case "links":
      return { id, type, span: s, refs: [] };
    case "modules":
      return { id, type, span: s, sections: [] };
    case "divider":
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
      return { id, type, span: s };
  }
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

function links(ids: string[], title?: string): Block {
  return {
    id: newId(),
    type: "links",
    span: 6,
    refs: ids.map(moduleRef),
    ...(title ? { title } : {}),
  };
}

function modulesBlock(sections: ModuleSectionId[], span: BlockSpan = 6): Block {
  return { id: newId(), type: "modules", span, sections };
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
      b("agenda", 3),
      b("tasks", 3),
      b("semester", 2),
      b("alerts", 2),
      b("budget", 2),
      b("now", 2),
      b("board", 2),
      b("notes", 2),
      b("contacts", 3),
      b("resources", 3),
      b("agent"),
      { ...modulesBlock([]), title: "Everything" },
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
      b("semester", 3),
      b("agenda", 3),
      b("tasks", 3),
      b("todo", 3),
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
      b("budget", 2),
      b("alerts", 4),
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
    [b("resources", 3), b("llm", 3), modulesBlock(["system"])],
    now,
  );

  return {
    version: 1,
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
