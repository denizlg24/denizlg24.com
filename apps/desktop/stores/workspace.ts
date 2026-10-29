import { z } from "zod";
import { create } from "zustand";
import { denizApi } from "@/lib/api-wrapper";
import { loadKeyValueStore } from "@/lib/platform-store";
import {
  type Block,
  type BlockSpan,
  HOME_PAGE_ID,
  pageRef,
  SIDEBAR_MAX_WIDTH,
  SIDEBAR_MIN_WIDTH,
  type SidebarPrefs,
  type Workspace,
  type WorkspacePage,
  type WorkspaceRef,
  workspaceSchema,
} from "@/lib/workspace/schema";
import { newId, seedWorkspace } from "@/lib/workspace/seed";

const STORE_FILENAME = "workspace.json";
const STORE_KEY = "workspace";
const SAVE_DEBOUNCE_MS = 400;
const MAX_RECENTS = 12;
/** Trashed pages older than this are purged on load, as Notion does. */
const TRASH_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

type WorkspaceState = {
  ready: boolean;
  workspace: Workspace;
  hydrate: () => Promise<void>;

  createPage: (parentId: string | null, title?: string) => string;
  updatePage: (
    id: string,
    patch: Partial<
      Pick<WorkspacePage, "title" | "icon" | "fullWidth" | "locked">
    >,
  ) => void;
  duplicatePage: (id: string) => string | null;
  trashPage: (id: string) => void;
  restorePage: (id: string) => void;
  deletePageForever: (id: string) => void;
  emptyTrash: () => void;
  /** Re-parents `id` under `parentId` at `index` among its new siblings. */
  movePage: (id: string, parentId: string | null, index: number) => void;

  addBlock: (pageId: string, block: Block, index?: number) => void;
  updateBlock: (pageId: string, block: Block) => void;
  removeBlock: (pageId: string, blockId: string) => void;
  duplicateBlock: (pageId: string, blockId: string) => void;
  moveBlock: (pageId: string, from: number, to: number) => void;
  setBlockSpan: (pageId: string, blockId: string, span: BlockSpan) => void;

  toggleFavorite: (ref: WorkspaceRef) => void;
  moveFavorite: (from: number, to: number) => void;
  recordVisit: (ref: WorkspaceRef) => void;

  setSidebar: (patch: Partial<SidebarPrefs>) => void;
  toggleSidebar: () => void;
  toggleSection: (sectionId: string) => void;
  toggleExpanded: (pageId: string) => void;
  setModuleHidden: (moduleId: string, hidden: boolean) => void;
};

const SERVER_ENDPOINT = "workspace";
const SERVER_DEBOUNCE_MS = 1500;
const api = new denizApi();

let saveTimer: ReturnType<typeof setTimeout> | null = null;
let serverTimer: ReturnType<typeof setTimeout> | null = null;

async function writeLocal(workspace: Workspace) {
  const store = await loadKeyValueStore(STORE_FILENAME, {});
  await store.set(STORE_KEY, workspace);
}

/**
 * Persists to the local file quickly and to the server a little later. A
 * failed server write is left for the next save to carry — the local copy
 * holds it meanwhile, and reconciliation on launch prefers the newer one.
 */
function scheduleSave(workspace: Workspace) {
  if (typeof window === "undefined") return;
  const stamped = { ...workspace, savedAt: new Date().toISOString() };
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    writeLocal(stamped).catch((error) =>
      console.error("Failed to save workspace:", error),
    );
  }, SAVE_DEBOUNCE_MS);
  if (serverTimer) clearTimeout(serverTimer);
  serverTimer = setTimeout(() => {
    void api
      .PUT<{ savedAt: string }>({ endpoint: SERVER_ENDPOINT, body: stamped })
      .then((result) => {
        if ("code" in result) {
          console.error("Failed to sync workspace:", result.message);
        }
      });
  }, SERVER_DEBOUNCE_MS);
}

async function fetchServerWorkspace(): Promise<Workspace | null> {
  const result = await api.GET({
    endpoint: SERVER_ENDPOINT,
    schema: z.object({ workspace: workspaceSchema.nullable() }),
  });
  return "code" in result ? null : result.workspace;
}

function normalize(workspace: Workspace): Workspace {
  const ws = purgeOldTrash(workspace);
  if (!ws.pages[HOME_PAGE_ID]) {
    ws.pages[HOME_PAGE_ID] = seedWorkspace().pages[HOME_PAGE_ID];
  }
  return ws;
}

function arrayMove<T>(list: T[], from: number, to: number): T[] {
  const next = list.slice();
  const [item] = next.splice(from, 1);
  if (item === undefined) return list;
  next.splice(Math.max(0, Math.min(to, next.length)), 0, item);
  return next;
}

/** Ids of `id` and every page beneath it. */
export function descendantIds(
  pages: Record<string, WorkspacePage>,
  id: string,
): string[] {
  const out = [id];
  for (let i = 0; i < out.length; i++) {
    for (const page of Object.values(pages)) {
      if (page.parentId === out[i]) out.push(page.id);
    }
  }
  return out;
}

export function childPages(
  pages: Record<string, WorkspacePage>,
  parentId: string | null,
): WorkspacePage[] {
  return Object.values(pages)
    .filter((p) => p.parentId === parentId && !p.deletedAt)
    .sort((a, b) => a.order - b.order);
}

export function pageAncestors(
  pages: Record<string, WorkspacePage>,
  id: string,
): WorkspacePage[] {
  const chain: WorkspacePage[] = [];
  let current = pages[id];
  const seen = new Set<string>();
  while (current?.parentId && !seen.has(current.parentId)) {
    seen.add(current.parentId);
    const parent = pages[current.parentId];
    if (!parent) break;
    chain.unshift(parent);
    current = parent;
  }
  return chain;
}

function nextOrder(
  pages: Record<string, WorkspacePage>,
  parentId: string | null,
): number {
  const siblings = childPages(pages, parentId);
  return siblings.length ? (siblings.at(-1)?.order ?? 0) + 1 : 0;
}

function purgeOldTrash(workspace: Workspace): Workspace {
  const cutoff = Date.now() - TRASH_RETENTION_MS;
  const pages = { ...workspace.pages };
  for (const page of Object.values(pages)) {
    if (page.deletedAt && Date.parse(page.deletedAt) < cutoff) {
      delete pages[page.id];
    }
  }
  return { ...workspace, pages };
}

export const useWorkspaceStore = create<WorkspaceState>((set, get) => {
  /** Applies `fn` to the workspace and persists the result. */
  const commit = (fn: (ws: Workspace) => Workspace) => {
    const next = fn(get().workspace);
    set({ workspace: next });
    scheduleSave(next);
  };

  const editPage = (id: string, fn: (page: WorkspacePage) => WorkspacePage) =>
    commit((ws) => {
      const page = ws.pages[id];
      if (!page) return ws;
      return {
        ...ws,
        pages: {
          ...ws.pages,
          [id]: { ...fn(page), updatedAt: new Date().toISOString() },
        },
      };
    });

  const editBlocks = (pageId: string, fn: (blocks: Block[]) => Block[]) =>
    editPage(pageId, (page) => ({ ...page, blocks: fn(page.blocks) }));

  return {
    ready: false,
    workspace: seedWorkspace(),

    hydrate: async () => {
      if (get().ready || typeof window === "undefined") return;
      let local: Workspace | null = null;
      try {
        const store = await loadKeyValueStore(STORE_FILENAME, {});
        const parsed = workspaceSchema.safeParse(await store.get(STORE_KEY));
        if (parsed.success) local = normalize(parsed.data);
      } catch (error) {
        console.error("Failed to load workspace:", error);
      }
      if (local) set({ workspace: local });
      set({ ready: true });

      // The server copy follows this owner across machines; the newer wins.
      const remote = await fetchServerWorkspace().catch(() => null);
      const localAt = local?.savedAt ?? "";
      if (remote && (remote.savedAt ?? "") > localAt) {
        const ws = normalize(remote);
        set({ workspace: ws });
        void writeLocal(ws).catch(() => {});
      } else if (!remote || localAt > (remote.savedAt ?? "")) {
        scheduleSave(get().workspace);
      }
    },

    createPage: (parentId, title = "") => {
      const id = newId();
      const now = new Date().toISOString();
      commit((ws) => ({
        ...ws,
        pages: {
          ...ws.pages,
          [id]: {
            id,
            title,
            icon: null,
            parentId,
            order: nextOrder(ws.pages, parentId),
            blocks: [],
            fullWidth: false,
            locked: false,
            createdAt: now,
            updatedAt: now,
            deletedAt: null,
          },
        },
        sidebar:
          parentId && !ws.sidebar.expandedPages.includes(parentId)
            ? {
                ...ws.sidebar,
                expandedPages: [...ws.sidebar.expandedPages, parentId],
              }
            : ws.sidebar,
      }));
      return id;
    },

    updatePage: (id, patch) => editPage(id, (page) => ({ ...page, ...patch })),

    duplicatePage: (id) => {
      const source = get().workspace.pages[id];
      if (!source) return null;
      const copyId = newId();
      const now = new Date().toISOString();
      commit((ws) => {
        const siblings = childPages(ws.pages, source.parentId);
        const after = siblings.findIndex((p) => p.id === id);
        const pages = { ...ws.pages };
        // Shift later siblings so the copy lands right after the original.
        for (const sibling of siblings.slice(after + 1)) {
          pages[sibling.id] = { ...sibling, order: sibling.order + 1 };
        }
        pages[copyId] = {
          ...source,
          id: copyId,
          title: source.title ? `${source.title} (copy)` : "",
          order: source.order + 0.5,
          blocks: source.blocks.map((block) => ({ ...block, id: newId() })),
          createdAt: now,
          updatedAt: now,
        };
        return { ...ws, pages };
      });
      return copyId;
    },

    trashPage: (id) => {
      if (id === HOME_PAGE_ID) return;
      const now = new Date().toISOString();
      commit((ws) => {
        const ids = new Set(descendantIds(ws.pages, id));
        const pages = { ...ws.pages };
        for (const pid of ids) {
          const page = pages[pid];
          if (page && !page.deletedAt) pages[pid] = { ...page, deletedAt: now };
        }
        return {
          ...ws,
          pages,
          favorites: ws.favorites.filter((ref) => !ids.has(ref.slice(5))),
        };
      });
    },

    restorePage: (id) =>
      commit((ws) => {
        const page = ws.pages[id];
        if (!page) return ws;
        const pages = { ...ws.pages };
        for (const pid of descendantIds(ws.pages, id)) {
          const p = pages[pid];
          if (p) pages[pid] = { ...p, deletedAt: null };
        }
        // A parent that is itself still in the trash cannot hold it.
        const parent = page.parentId ? pages[page.parentId] : null;
        if (page.parentId && (!parent || parent.deletedAt)) {
          pages[id] = {
            ...(pages[id] ?? page),
            parentId: null,
            order: nextOrder(pages, null),
          };
        }
        return { ...ws, pages };
      }),

    deletePageForever: (id) => {
      if (id === HOME_PAGE_ID) return;
      commit((ws) => {
        const ids = new Set(descendantIds(ws.pages, id));
        const pages = { ...ws.pages };
        for (const pid of ids) delete pages[pid];
        const refs = new Set([...ids].map(pageRef));
        return {
          ...ws,
          pages,
          favorites: ws.favorites.filter((ref) => !refs.has(ref)),
          recents: ws.recents.filter((ref) => !refs.has(ref)),
        };
      });
    },

    emptyTrash: () =>
      commit((ws) => {
        const pages = { ...ws.pages };
        const removed = new Set<string>();
        for (const page of Object.values(pages)) {
          if (page.deletedAt) {
            delete pages[page.id];
            removed.add(pageRef(page.id));
          }
        }
        return {
          ...ws,
          pages,
          recents: ws.recents.filter((ref) => !removed.has(ref)),
        };
      }),

    movePage: (id, parentId, index) => {
      if (id === HOME_PAGE_ID && parentId !== null) return;
      const ws = get().workspace;
      if (parentId && descendantIds(ws.pages, id).includes(parentId)) return;
      commit((current) => {
        const page = current.pages[id];
        if (!page) return current;
        const siblings = childPages(current.pages, parentId).filter(
          (p) => p.id !== id,
        );
        siblings.splice(Math.max(0, Math.min(index, siblings.length)), 0, page);
        const pages = { ...current.pages };
        siblings.forEach((sibling, order) => {
          pages[sibling.id] = {
            ...(pages[sibling.id] ?? sibling),
            order,
            ...(sibling.id === id ? { parentId } : {}),
          };
        });
        return { ...current, pages };
      });
    },

    addBlock: (pageId, block, index) =>
      editBlocks(pageId, (blocks) => {
        const next = blocks.slice();
        next.splice(index ?? next.length, 0, block);
        return next;
      }),

    updateBlock: (pageId, block) =>
      editBlocks(pageId, (blocks) =>
        blocks.map((b) => (b.id === block.id ? block : b)),
      ),

    removeBlock: (pageId, blockId) =>
      editBlocks(pageId, (blocks) => blocks.filter((b) => b.id !== blockId)),

    duplicateBlock: (pageId, blockId) =>
      editBlocks(pageId, (blocks) => {
        const index = blocks.findIndex((b) => b.id === blockId);
        const source = blocks[index];
        if (!source) return blocks;
        const next = blocks.slice();
        next.splice(index + 1, 0, { ...source, id: newId() });
        return next;
      }),

    moveBlock: (pageId, from, to) =>
      editBlocks(pageId, (blocks) => arrayMove(blocks, from, to)),

    setBlockSpan: (pageId, blockId, span) =>
      editBlocks(pageId, (blocks) =>
        blocks.map((b) => (b.id === blockId ? { ...b, span } : b)),
      ),

    toggleFavorite: (ref) =>
      commit((ws) => ({
        ...ws,
        favorites: ws.favorites.includes(ref)
          ? ws.favorites.filter((f) => f !== ref)
          : [...ws.favorites, ref],
      })),

    moveFavorite: (from, to) =>
      commit((ws) => ({ ...ws, favorites: arrayMove(ws.favorites, from, to) })),

    recordVisit: (ref) => {
      const ws = get().workspace;
      if (ws.recents[0] === ref) return;
      commit((current) => ({
        ...current,
        recents: [ref, ...current.recents.filter((r) => r !== ref)].slice(
          0,
          MAX_RECENTS,
        ),
      }));
    },

    setSidebar: (patch) =>
      commit((ws) => {
        const sidebar = { ...ws.sidebar, ...patch };
        sidebar.width = Math.min(
          SIDEBAR_MAX_WIDTH,
          Math.max(SIDEBAR_MIN_WIDTH, Math.round(sidebar.width)),
        );
        return { ...ws, sidebar };
      }),

    toggleSidebar: () =>
      commit((ws) => ({
        ...ws,
        sidebar: { ...ws.sidebar, collapsed: !ws.sidebar.collapsed },
      })),

    toggleSection: (sectionId) =>
      commit((ws) => {
        const list = ws.sidebar.collapsedSections;
        return {
          ...ws,
          sidebar: {
            ...ws.sidebar,
            collapsedSections: list.includes(sectionId)
              ? list.filter((s) => s !== sectionId)
              : [...list, sectionId],
          },
        };
      }),

    toggleExpanded: (pageId) =>
      commit((ws) => {
        const list = ws.sidebar.expandedPages;
        return {
          ...ws,
          sidebar: {
            ...ws.sidebar,
            expandedPages: list.includes(pageId)
              ? list.filter((s) => s !== pageId)
              : [...list, pageId],
          },
        };
      }),

    setModuleHidden: (moduleId, hidden) =>
      commit((ws) => {
        const list = ws.sidebar.hiddenModules.filter((m) => m !== moduleId);
        return {
          ...ws,
          sidebar: {
            ...ws.sidebar,
            hiddenModules: hidden ? [...list, moduleId] : list,
          },
        };
      }),
  };
});
