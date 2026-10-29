"use client";

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
} from "@repo/schemas";
import { toast } from "sonner";
import { z } from "zod";
import { create } from "zustand";
import { AdminApiError, type AdminClient } from "../client";
import { newId, seedWorkspace } from "./seed";

const SAVE_DEBOUNCE_MS = 400;
const SERVER_DEBOUNCE_MS = 1500;
const SERVER_ENDPOINT = "workspace";
const MAX_RECENTS = 12;
/** Trashed pages older than this are purged on load, as Notion does. */
const TRASH_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

/** A copy kept on the device so launch never waits on the network. */
export interface WorkspaceLocalCopy {
  load: () => Promise<unknown>;
  save: (workspace: Workspace) => Promise<void>;
}

export interface WorkspacePersistence {
  client: AdminClient;
  /** Desktop keeps one; web has only the server. */
  local?: WorkspaceLocalCopy;
}

type WorkspaceState = {
  /** A copy worth editing is loaded: the local one, or the server's. */
  ready: boolean;
  /** Set when there is no local copy and the server could not be read. */
  error: string | null;
  workspace: Workspace;
  hydrate: (persistence: WorkspacePersistence) => Promise<void>;
  /** Adopts the server copy when it was written elsewhere since this one's base. */
  refresh: () => Promise<void>;

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

/*
 * Sync state lives beside the store rather than in it: none of it renders.
 *
 * `base` is the `savedAt` of the server copy this one descends from. Every
 * save sends it, and the server refuses one whose base it no longer holds —
 * desktop and web both write this document. `undefined` means the server has
 * not answered yet, so a save reconciles first; `null` means it holds none.
 */
let persistence: WorkspacePersistence | null = null;
let base: string | null | undefined;
/** `savedAt` of the newest copy on this device: the local file, or the last edit. */
let localAt = "";
/** The newest edit the server has not accepted yet. */
let pending: Workspace | null = null;
let inflight: Promise<void> | null = null;
let localTimer: ReturnType<typeof setTimeout> | null = null;
let serverTimer: ReturnType<typeof setTimeout> | null = null;

const remoteResponseSchema = z.object({
  workspace: workspaceSchema.nullable(),
});

async function fetchRemote(client: AdminClient): Promise<Workspace | null> {
  return remoteResponseSchema.parse(await client.get(SERVER_ENDPOINT))
    .workspace;
}

function clearTimers() {
  if (localTimer) clearTimeout(localTimer);
  if (serverTimer) clearTimeout(serverTimer);
  localTimer = null;
  serverTimer = null;
}

/** Replaces whatever is here with the server's copy, unsaved edits included. */
function adopt(remote: Workspace) {
  clearTimers();
  pending = null;
  base = remote.savedAt ?? null;
  localAt = remote.savedAt ?? "";
  const ws = normalize(remote);
  useWorkspaceStore.setState({ workspace: ws, ready: true, error: null });
  persistence?.local
    ?.save(ws)
    .catch((error) => console.error("Failed to save workspace:", error));
}

function stamp(workspace: Workspace): Workspace {
  const stamped = { ...workspace, savedAt: new Date().toISOString() };
  localAt = stamped.savedAt;
  return stamped;
}

/**
 * The launch-time merge, and the one after an offline start: the newer copy
 * wins. A later edit on this device is pushed with the server's stamp as its
 * base; an older one is replaced. Throws when the server cannot be read,
 * leaving `base` unknown.
 */
async function reconcile() {
  if (!persistence) return;
  const remote = await fetchRemote(persistence.client);
  const remoteAt = remote?.savedAt ?? "";
  if (remote && remoteAt > localAt) {
    adopt(remote);
    return;
  }
  base = remote ? (remote.savedAt ?? null) : null;
  useWorkspaceStore.setState({ ready: true, error: null });
  if (!remote || localAt > remoteAt) {
    pending ??= stamp(useWorkspaceStore.getState().workspace);
    void flush();
  }
}

/** Sends the pending edit, one request at a time so each carries the base the last one set. */
function flush(): Promise<void> {
  if (inflight) return inflight;
  const p = persistence;
  if (!p || !pending) return Promise.resolve();
  let sent: Workspace | null = null;
  inflight = (async () => {
    if (base === undefined) await reconcile();
    const copy = pending;
    if (!copy || base === undefined) return;
    sent = copy;
    try {
      const { savedAt } = await p.client.put<{ savedAt: string }>(
        SERVER_ENDPOINT,
        { ...copy, baseSavedAt: base },
      );
      base = savedAt;
      if (pending === copy) pending = null;
    } catch (error) {
      if (error instanceof AdminApiError && error.code === 409) {
        const remote = workspaceSchema.safeParse(error.details?.workspace);
        if (remote.success) {
          adopt(remote.data);
          toast("Workspace changed elsewhere — reloaded");
          return;
        }
      }
      throw error;
    }
  })()
    // Left for the next edit to carry; a local copy holds it meanwhile.
    .catch((error) => console.error("Failed to sync workspace:", error))
    .finally(() => {
      inflight = null;
      if (sent && pending && pending !== sent && !serverTimer) void flush();
    });
  return inflight;
}

/** Persists to the device quickly and to the server a little later. */
function scheduleSave(workspace: Workspace) {
  if (!persistence) return;
  const stamped = stamp(workspace);
  pending = stamped;
  const local = persistence.local;
  if (local) {
    if (localTimer) clearTimeout(localTimer);
    localTimer = setTimeout(() => {
      localTimer = null;
      local
        .save(stamped)
        .catch((error) => console.error("Failed to save workspace:", error));
    }, SAVE_DEBOUNCE_MS);
  }
  if (serverTimer) clearTimeout(serverTimer);
  serverTimer = setTimeout(() => {
    serverTimer = null;
    void flush();
  }, SERVER_DEBOUNCE_MS);
}

async function refreshFromServer() {
  if (!persistence) return;
  if (base === undefined) {
    if (inflight) return;
    await reconcile().catch((error) => {
      if (!persistence?.local) {
        useWorkspaceStore.setState({
          error: error instanceof Error ? error.message : "Failed to load",
        });
      }
    });
    return;
  }
  // An edit on its way settles this itself: the server answers it with 409.
  if (pending || inflight) return;
  const remote = await fetchRemote(persistence.client).catch(() => null);
  if (remote && (remote.savedAt ?? null) !== base && !pending) adopt(remote);
}

let listening = false;

function listenForReturn() {
  if (listening || typeof window === "undefined") return;
  listening = true;
  const onReturn = () => {
    if (document.visibilityState === "visible") void refreshFromServer();
  };
  window.addEventListener("focus", onReturn);
  document.addEventListener("visibilitychange", onReturn);
}

/** Forgets the persistence and sync state, so a test can hydrate again. */
export function resetWorkspaceSync() {
  clearTimers();
  persistence = null;
  base = undefined;
  localAt = "";
  pending = null;
  inflight = null;
}

/** Sends any pending edit now instead of after the debounce. */
export function flushWorkspace(): Promise<void> {
  if (serverTimer) clearTimeout(serverTimer);
  serverTimer = null;
  return flush();
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

    error: null,

    hydrate: async (config) => {
      if (persistence) return;
      persistence = config;
      listenForReturn();
      if (config.local) {
        try {
          const parsed = workspaceSchema.safeParse(await config.local.load());
          if (parsed.success) {
            localAt = parsed.data.savedAt ?? "";
            set({ workspace: normalize(parsed.data) });
          }
        } catch (error) {
          console.error("Failed to load workspace:", error);
        }
        set({ ready: true });
      }
      await refreshFromServer();
    },

    refresh: refreshFromServer,

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
