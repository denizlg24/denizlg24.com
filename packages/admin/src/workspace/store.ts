"use client";

import {
  type Block,
  type BlockSpan,
  HOME_PAGE_ID,
  type PageMetaPatch,
  pageRef,
  SIDEBAR_MAX_WIDTH,
  SIDEBAR_MIN_WIDTH,
  type SidebarPrefs,
  type Workspace,
  type WorkspaceCache,
  type WorkspaceOp,
  type WorkspacePage,
  type WorkspacePageDoc,
  type WorkspacePageSummary,
  type WorkspacePrefsInput,
  type WorkspaceRef,
  workspaceCacheSchema,
  workspaceChangesSchema,
  workspacePageDocSchema,
  workspacePageSummarySchema,
  workspacePrefsSchema,
} from "@repo/schemas";
import { applyWorkspaceOps, orderAt } from "@repo/utils/workspace-ops";
import { toast } from "sonner";
import { z } from "zod";
import { create } from "zustand";
import { AdminApiError, type AdminClient } from "../client";
import { newId, seedWorkspace } from "./seed";

const CACHE_DEBOUNCE_MS = 400;
const OPS_DEBOUNCE_MS = 500;
const PREFS_DEBOUNCE_MS = 1000;
const RETRY_MS = 5_000;
const POLL_MS = 5_000;
const MAX_RECENTS = 12;
const ROOT = "workspace";

/**
 * The device copy desktop keeps so launch never waits on the network. It is
 * a read cache: what the server says always replaces it.
 */
export interface WorkspaceLocalCopy {
  load: () => Promise<unknown>;
  save: (workspace: WorkspaceCache) => Promise<void>;
}

export interface WorkspacePersistence {
  client: AdminClient;
  /** Desktop keeps one; web has only the server. */
  local?: WorkspaceLocalCopy;
}

type WorkspaceState = {
  /** The page tree is known: from the device copy, or the server. */
  ready: boolean;
  /** Set when there is no local copy and the server could not be read. */
  error: string | null;
  workspace: Workspace;
  /** Rev of each page whose blocks are held; a page absent here shows no blocks yet. */
  loaded: Record<string, number>;
  /** Blocks per page, known before a page's blocks are loaded. */
  blockCounts: Record<string, number>;
  hydrate: (persistence: WorkspacePersistence) => Promise<void>;
  /** Re-reads the tree and anything that changed elsewhere. */
  refresh: () => Promise<void>;
  /** Loads a page's blocks when they are missing or older than the server's. */
  ensurePage: (id: string) => Promise<void>;

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
 * Each page is edited through ops. `confirmed` holds the last copy the server
 * returned; `queued` the ops not sent yet; `sending` the batch in flight. The
 * page on screen is always `confirmed` with `sending` and `queued` replayed
 * on top, so a server answer — ours or a change made elsewhere — is merged
 * under unsent edits instead of replacing them.
 */
let persistence: WorkspacePersistence | null = null;
const confirmed = new Map<string, WorkspacePageDoc>();
const queued = new Map<string, WorkspaceOp[]>();
const sending = new Map<string, WorkspaceOp[]>();
const opTimers = new Map<string, ReturnType<typeof setTimeout>>();
const inflight = new Map<string, Promise<void>>();
/** Server rev per page from summaries and the feed. */
const serverRevs = new Map<string, number>();
/** Page-level calls (create, move, trash…) not yet answered. */
const structural = new Set<Promise<unknown>>();
/** Pages whose create call is on its way; their ops wait for it. */
const creating = new Map<string, Promise<unknown>>();
let prefsTimer: ReturnType<typeof setTimeout> | null = null;
let prefsDirty = false;
let prefsAt: string | null = null;
let cacheTimer: ReturnType<typeof setTimeout> | null = null;
let cursor: string | null = null;
let pollTimer: ReturnType<typeof setInterval> | null = null;
let polling: Promise<void> | null = null;

const pagesResponseSchema = z.object({
  pages: z.array(workspacePageSummarySchema),
});
const pageResponseSchema = z.object({ page: workspacePageDocSchema });
const prefsResponseSchema = z.object({ prefs: workspacePrefsSchema });
const pagesChangedSchema = z.object({
  pages: z.array(workspacePageSummarySchema),
});

const state = () => useWorkspaceStore.getState();

function client(): AdminClient | null {
  return persistence?.client ?? null;
}

function pagePath(id: string, suffix = ""): string {
  return `${ROOT}/pages/${encodeURIComponent(id)}${suffix}`;
}

function logFailure(what: string) {
  return (error: unknown) => console.error(`Failed to ${what}:`, error);
}

function stripRev(doc: WorkspacePageDoc): WorkspacePage {
  const { rev: _rev, ...page } = doc;
  return page;
}

function fromSummary(
  summary: WorkspacePageSummary,
  blocks: Block[],
): WorkspacePage {
  const { rev: _rev, blockCount: _count, ...meta } = summary;
  return { ...meta, blocks };
}

function pendingOps(id: string): WorkspaceOp[] {
  return [...(sending.get(id) ?? []), ...(queued.get(id) ?? [])];
}

/** The server's copy with every unsent edit replayed on top. */
function withPending(doc: WorkspacePageDoc): WorkspacePage {
  return applyWorkspaceOps(stripRev(doc), pendingOps(doc.id), { lenient: true })
    .page;
}

/** `count` is the server's block count for a page whose blocks are not held. */
function setPage(page: WorkspacePage, rev?: number, count?: number) {
  useWorkspaceStore.setState((s) => {
    const held = rev !== undefined || page.id in s.loaded;
    return {
      workspace: {
        ...s.workspace,
        pages: { ...s.workspace.pages, [page.id]: page },
      },
      loaded: rev === undefined ? s.loaded : { ...s.loaded, [page.id]: rev },
      blockCounts: {
        ...s.blockCounts,
        [page.id]: held
          ? page.blocks.length
          : (count ?? s.blockCounts[page.id] ?? page.blocks.length),
      },
    };
  });
  scheduleCache();
}

/** Takes a full page from the server. */
function adoptDoc(doc: WorkspacePageDoc) {
  const known = confirmed.get(doc.id);
  if (known && known.rev > doc.rev) return;
  confirmed.set(doc.id, doc);
  serverRevs.set(doc.id, Math.max(serverRevs.get(doc.id) ?? 0, doc.rev));
  setPage(withPending(doc), doc.rev);
}

/** Takes a page's fields from a summary, keeping the blocks held here and unsent field edits. */
function adoptSummary(summary: WorkspacePageSummary) {
  serverRevs.set(
    summary.id,
    Math.max(serverRevs.get(summary.id) ?? 0, summary.rev),
  );
  const current = state().workspace.pages[summary.id];
  const fieldEdits = pendingOps(summary.id).filter((op) => op.op === "page");
  setPage(
    applyWorkspaceOps(fromSummary(summary, current?.blocks ?? []), fieldEdits, {
      lenient: true,
    }).page,
    undefined,
    summary.blockCount,
  );
}

function dropPages(ids: readonly string[]) {
  if (ids.length === 0) return;
  for (const id of ids) {
    confirmed.delete(id);
    queued.delete(id);
    serverRevs.delete(id);
  }
  const gone = new Set(ids);
  useWorkspaceStore.setState((s) => {
    const pages = { ...s.workspace.pages };
    const loaded = { ...s.loaded };
    for (const id of ids) {
      delete pages[id];
      delete loaded[id];
    }
    const refs = new Set([...gone].map(pageRef));
    return {
      workspace: {
        ...s.workspace,
        pages,
        favorites: s.workspace.favorites.filter((r) => !refs.has(r)),
        recents: s.workspace.recents.filter((r) => !refs.has(r)),
      },
      loaded,
    };
  });
  scheduleCache();
}

function scheduleCache() {
  const local = persistence?.local;
  if (!local) return;
  if (cacheTimer) clearTimeout(cacheTimer);
  cacheTimer = setTimeout(() => {
    cacheTimer = null;
    const { workspace, loaded } = state();
    local
      .save({ ...workspace, revs: loaded })
      .catch(logFailure("cache workspace"));
  }, CACHE_DEBOUNCE_MS);
}

function track<T>(promise: Promise<T>): Promise<T> {
  structural.add(promise);
  void promise.finally(() => structural.delete(promise)).catch(() => {});
  return promise;
}

// --- ops --------------------------------------------------------------------

function enqueue(pageId: string, ops: WorkspaceOp[]) {
  const list = queued.get(pageId) ?? [];
  list.push(...ops);
  queued.set(pageId, list);
  if (!client()) return;
  const timer = opTimers.get(pageId);
  if (timer) clearTimeout(timer);
  opTimers.set(
    pageId,
    setTimeout(() => {
      opTimers.delete(pageId);
      void flushPage(pageId);
    }, OPS_DEBOUNCE_MS),
  );
}

function retryLater(pageId: string) {
  if (opTimers.has(pageId)) return;
  opTimers.set(
    pageId,
    setTimeout(() => {
      opTimers.delete(pageId);
      void flushPage(pageId);
    }, RETRY_MS),
  );
}

/** Sends a page's queued ops, one batch at a time so each carries the rev the last one produced. */
function flushPage(pageId: string): Promise<void> {
  const running = inflight.get(pageId);
  if (running) return running;
  const api = client();
  const batch = queued.get(pageId);
  if (!api || !batch?.length) return Promise.resolve();
  queued.delete(pageId);
  sending.set(pageId, batch);
  const run = (async () => {
    // A page still being created has nothing to apply ops to yet.
    await creating.get(pageId);
    const baseRev =
      confirmed.get(pageId)?.rev ??
      state().loaded[pageId] ??
      serverRevs.get(pageId) ??
      0;
    try {
      const { page } = pageResponseSchema.parse(
        await api.post(pagePath(pageId, "/ops"), { baseRev, ops: batch }),
      );
      sending.delete(pageId);
      adoptDoc(page);
    } catch (error) {
      sending.delete(pageId);
      if (error instanceof AdminApiError && error.code === 409) {
        const current = workspacePageDocSchema.safeParse(error.details?.page);
        if (current.success) {
          confirmed.delete(pageId);
          adoptDoc(current.data);
          toast("Page changed elsewhere — reloaded");
          return;
        }
      }
      if (
        error instanceof AdminApiError &&
        error.code >= 400 &&
        error.code < 500
      ) {
        // Refused for good (gone, invalid): show what the server holds.
        console.error("Workspace edit refused:", error);
        await loadPage(pageId).catch(() => {});
        return;
      }
      // Unreachable: keep the edit and try again.
      queued.set(pageId, [...batch, ...(queued.get(pageId) ?? [])]);
      retryLater(pageId);
      throw error;
    }
  })()
    .catch(logFailure("sync workspace page"))
    .finally(() => {
      inflight.delete(pageId);
      if (queued.get(pageId)?.length && !opTimers.has(pageId)) {
        void flushPage(pageId);
      }
    });
  inflight.set(pageId, run);
  return run;
}

/** Applies ops here at once and queues them for the server. */
function editPage(pageId: string, ops: WorkspaceOp[]) {
  const page = state().workspace.pages[pageId];
  if (!page || ops.length === 0) return;
  const result = applyWorkspaceOps(page, ops, { lenient: true });
  if (result.applied.length === 0) return;
  setPage({ ...result.page, updatedAt: new Date().toISOString() });
  enqueue(pageId, ops);
}

// --- prefs ------------------------------------------------------------------

function prefsOf(workspace: Workspace): WorkspacePrefsInput {
  return {
    favorites: workspace.favorites,
    recents: workspace.recents,
    sidebar: workspace.sidebar,
  };
}

function setPrefs(fn: (ws: Workspace) => Partial<WorkspacePrefsInput>) {
  useWorkspaceStore.setState((s) => ({
    workspace: { ...s.workspace, ...fn(s.workspace) },
  }));
  scheduleCache();
  if (!client()) return;
  prefsDirty = true;
  if (prefsTimer) clearTimeout(prefsTimer);
  prefsTimer = setTimeout(() => {
    prefsTimer = null;
    void flushPrefs();
  }, PREFS_DEBOUNCE_MS);
}

/** The owner is the only writer of prefs; the last write wins. */
async function flushPrefs() {
  const api = client();
  if (!api || !prefsDirty) return;
  prefsDirty = false;
  try {
    const { prefs } = prefsResponseSchema.parse(
      await api.put(`${ROOT}/prefs`, prefsOf(state().workspace)),
    );
    prefsAt = prefs.updatedAt;
  } catch (error) {
    prefsDirty = true;
    console.error("Failed to save workspace prefs:", error);
  }
}

async function loadPrefs(api: AdminClient) {
  if (prefsDirty) return;
  const { prefs } = prefsResponseSchema.parse(await api.get(`${ROOT}/prefs`));
  prefsAt = prefs.updatedAt;
  if (prefsDirty) return;
  useWorkspaceStore.setState((s) => ({
    workspace: {
      ...s.workspace,
      favorites: prefs.favorites,
      recents: prefs.recents,
      sidebar: prefs.sidebar,
    },
  }));
  scheduleCache();
}

// --- loading ----------------------------------------------------------------

async function loadPage(id: string): Promise<void> {
  const api = client();
  if (!api) return;
  const { page } = pageResponseSchema.parse(await api.get(pagePath(id)));
  confirmed.delete(id);
  adoptDoc(page);
}

/** Pages the server lacks entirely: a new install gets the seed. */
async function seedServer(api: AdminClient) {
  const seed = seedWorkspace();
  const pages = Object.values(seed.pages).sort(
    (a, b) => Number(a.parentId !== null) - Number(b.parentId !== null),
  );
  for (const page of pages) {
    const { page: created } = pageResponseSchema.parse(
      await api.post(`${ROOT}/pages`, {
        id: page.id,
        title: page.title,
        icon: page.icon,
        parentId: page.parentId,
        blocks: page.blocks,
        fullWidth: page.fullWidth,
        locked: page.locked,
      }),
    );
    adoptDoc(created);
  }
  useWorkspaceStore.setState((s) => ({
    workspace: {
      ...s.workspace,
      favorites: seed.favorites,
      sidebar: seed.sidebar,
    },
  }));
  prefsDirty = true;
  await flushPrefs();
}

/** The tree from the server; pages it no longer has are dropped here too. */
async function loadTree(api: AdminClient) {
  const { pages } = pagesResponseSchema.parse(await api.get(`${ROOT}/pages`));
  if (pages.length === 0) {
    await seedServer(api);
    return;
  }
  const held = state().workspace.pages;
  const live = new Set(pages.map((p) => p.id));
  const unsent = (id: string) => pendingOps(id).length > 0;
  dropPages(Object.keys(held).filter((id) => !live.has(id) && !unsent(id)));
  for (const summary of pages) adoptSummary(summary);
  if (!live.has(HOME_PAGE_ID)) {
    const home = seedWorkspace().pages[HOME_PAGE_ID];
    if (home) {
      const { page } = pageResponseSchema.parse(
        await api.post(`${ROOT}/pages`, {
          id: home.id,
          title: home.title,
          icon: home.icon,
          parentId: null,
          index: 0,
          blocks: home.blocks,
        }),
      );
      adoptDoc(page);
    }
  }
  await refreshStale();
}

/** Re-fetches every held page the server has a newer rev of, unless an edit is on its way. */
async function refreshStale() {
  const { loaded } = state();
  await Promise.all(
    Object.entries(loaded)
      .filter(
        ([id, rev]) =>
          (serverRevs.get(id) ?? rev) > rev &&
          !inflight.has(id) &&
          !queued.get(id)?.length,
      )
      .map(([id]) => loadPage(id).catch(logFailure("load workspace page"))),
  );
}

/** One poll of the change feed. */
async function pollChanges(): Promise<void> {
  const api = client();
  if (!api) return;
  if (polling) return polling;
  polling = (async () => {
    const changes = workspaceChangesSchema.parse(
      await api.get(
        cursor
          ? `${ROOT}/changes?since=${encodeURIComponent(cursor)}`
          : `${ROOT}/changes`,
      ),
    );
    // A tree change of ours still on its way would be shown undone; read
    // the same window again next time instead.
    if (structural.size > 0) return;
    cursor = changes.cursor;
    for (const summary of changes.pages) {
      if ((serverRevs.get(summary.id) ?? -1) < summary.rev) {
        adoptSummary(summary);
      }
    }
    dropPages(changes.purged.filter((id) => state().workspace.pages[id]));
    await refreshStale();
    if (changes.prefsUpdatedAt && changes.prefsUpdatedAt !== prefsAt) {
      await loadPrefs(api);
    }
  })()
    .catch(logFailure("poll workspace changes"))
    .finally(() => {
      polling = null;
    });
  return polling;
}

function visible() {
  return (
    typeof document === "undefined" ||
    (document.visibilityState === "visible" && document.hasFocus())
  );
}

let listening = false;

function listen() {
  if (listening || typeof window === "undefined") return;
  listening = true;
  const onReturn = () => {
    if (document.visibilityState === "visible") void pollChanges();
  };
  window.addEventListener("focus", onReturn);
  document.addEventListener("visibilitychange", onReturn);
  // Best effort: a closing window gets its unsent edits out.
  window.addEventListener("pagehide", () => void flushWorkspace());
  pollTimer = setInterval(() => {
    if (visible()) void pollChanges();
  }, POLL_MS);
}

async function fetchServer() {
  const api = client();
  if (!api) return;
  try {
    await loadTree(api);
    await loadPrefs(api);
    // Start the feed from now: everything before is already loaded.
    cursor ??= new Date().toISOString();
    useWorkspaceStore.setState({ ready: true, error: null });
  } catch (error) {
    if (!state().ready) {
      useWorkspaceStore.setState({
        error: error instanceof Error ? error.message : "Failed to load",
      });
    }
    console.error("Failed to load workspace:", error);
  }
}

/** Forgets the persistence and sync state, so a test can hydrate again. */
export function resetWorkspaceSync() {
  for (const timer of opTimers.values()) clearTimeout(timer);
  if (prefsTimer) clearTimeout(prefsTimer);
  if (cacheTimer) clearTimeout(cacheTimer);
  if (pollTimer) clearInterval(pollTimer);
  opTimers.clear();
  confirmed.clear();
  queued.clear();
  sending.clear();
  inflight.clear();
  serverRevs.clear();
  structural.clear();
  creating.clear();
  persistence = null;
  prefsTimer = null;
  prefsDirty = false;
  prefsAt = null;
  cacheTimer = null;
  cursor = null;
  pollTimer = null;
  polling = null;
  listening = false;
}

/** Sends every pending edit now instead of after the debounce. */
export async function flushWorkspace(): Promise<void> {
  await Promise.allSettled([...structural]);
  for (const [pageId, timer] of opTimers) {
    clearTimeout(timer);
    opTimers.delete(pageId);
  }
  if (prefsTimer) {
    clearTimeout(prefsTimer);
    prefsTimer = null;
  }
  await Promise.all([
    ...[...queued.keys(), ...inflight.keys()].map(flushPage),
    flushPrefs(),
  ]);
  if ([...queued.values()].some((ops) => ops.length > 0)) {
    await Promise.all([...queued.keys()].map(flushPage));
  }
}

/** Polls the change feed once, as the focus listener would. */
export function pollWorkspaceChanges(): Promise<void> {
  return pollChanges();
}

// --- tree helpers -----------------------------------------------------------

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

function siblingOrders(
  pages: Record<string, WorkspacePage>,
  parentId: string | null,
  except: string,
): number[] {
  return childPages(pages, parentId)
    .filter((p) => p.id !== except)
    .map((p) => p.order);
}

/** Where a block lands for `index`: absent or past the end appends, 0 is first. */
function anchorFor(blocks: Block[], index: number | undefined) {
  if (index === undefined || index >= blocks.length) return undefined;
  if (index <= 0) return null;
  return blocks[index - 1]?.id ?? null;
}

function blockFields(block: Block): Record<string, unknown> {
  const { id: _id, type: _type, ...rest } = block;
  return rest;
}

/** Runs a page-level call against the server, re-reading the tree if it fails. */
function structuralCall<T>(
  call: (api: AdminClient) => Promise<T>,
  createdId?: string,
) {
  const api = client();
  if (!api) return;
  const promise = track(
    call(api).catch(async (error) => {
      console.error("Workspace change failed:", error);
      await loadTree(api).catch(() => {});
    }),
  );
  if (createdId) {
    creating.set(createdId, promise);
    void promise.finally(() => creating.delete(createdId));
  }
}

function setPages(
  fn: (pages: Record<string, WorkspacePage>) => Record<string, WorkspacePage>,
) {
  useWorkspaceStore.setState((s) => ({
    workspace: { ...s.workspace, pages: fn(s.workspace.pages) },
  }));
  scheduleCache();
}

function adoptSummaries(body: unknown) {
  const parsed = pagesChangedSchema.safeParse(body);
  if (parsed.success)
    for (const summary of parsed.data.pages) adoptSummary(summary);
}

function adoptResponseDoc(body: unknown) {
  const parsed = pageResponseSchema.safeParse(body);
  if (parsed.success) {
    // Only the fields: the blocks may lag edits still being sent.
    const { blocks: _blocks, ...meta } = parsed.data.page;
    adoptSummary({ ...meta, blockCount: parsed.data.page.blocks.length });
  }
}

export const useWorkspaceStore = create<WorkspaceState>((set, get) => ({
  ready: false,
  error: null,
  workspace: seedWorkspace(),
  loaded: {},
  blockCounts: {},

  hydrate: async (config) => {
    if (persistence) return;
    persistence = config;
    if (config.local) {
      try {
        const parsed = workspaceCacheSchema.safeParse(
          await config.local.load(),
        );
        if (parsed.success) {
          const { revs, ...workspace } = parsed.data;
          // A 3.0.0 copy carries no revs: show it, and refetch each page when opened.
          const loaded =
            revs ??
            Object.fromEntries(
              Object.keys(workspace.pages).map((id) => [id, 0]),
            );
          set({ workspace, loaded, ready: true });
        }
      } catch (error) {
        console.error("Failed to load cached workspace:", error);
      }
    }
    if (!get().ready) set({ workspace: { ...seedWorkspace(), pages: {} } });
    listen();
    await fetchServer();
  },

  refresh: async () => {
    const api = client();
    if (!api) return;
    if (!get().ready) {
      await fetchServer();
      return;
    }
    await pollChanges();
  },

  ensurePage: async (id) => {
    const held = get().loaded[id];
    if (held !== undefined && held >= (serverRevs.get(id) ?? held)) return;
    if (inflight.has(id) || queued.get(id)?.length) return;
    await loadPage(id).catch(logFailure("load workspace page"));
  },

  createPage: (parentId, title = "") => {
    const id = newId();
    const now = new Date().toISOString();
    const pages = get().workspace.pages;
    const siblings = siblingOrders(pages, parentId, id);
    const page: WorkspacePage = {
      id,
      title,
      icon: null,
      parentId,
      order: orderAt(siblings, siblings.length),
      blocks: [],
      fullWidth: false,
      locked: false,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    };
    set((s) => ({ loaded: { ...s.loaded, [id]: 0 } }));
    setPage(page);
    if (parentId && !get().workspace.sidebar.expandedPages.includes(parentId)) {
      setPrefs((ws) => ({
        sidebar: {
          ...ws.sidebar,
          expandedPages: [...ws.sidebar.expandedPages, parentId],
        },
      }));
    }
    structuralCall(async (api) => {
      const body = await api.post(`${ROOT}/pages`, {
        id,
        title,
        parentId,
        index: siblings.length,
      });
      // Ops queued meanwhile replay on top and go out against rev 1.
      adoptDoc(pageResponseSchema.parse(body).page);
    }, id);
    return id;
  },

  updatePage: (id, patch) => {
    const set: PageMetaPatch = {};
    if (patch.title !== undefined) set.title = patch.title;
    if (patch.icon !== undefined) set.icon = patch.icon;
    if (patch.fullWidth !== undefined) set.fullWidth = patch.fullWidth;
    if (patch.locked !== undefined) set.locked = patch.locked;
    editPage(id, [{ op: "page", set }]);
  },

  duplicatePage: (id) => {
    const source = get().workspace.pages[id];
    if (!source) return null;
    const copyId = newId();
    const now = new Date().toISOString();
    const pages = get().workspace.pages;
    const siblings = childPages(pages, source.parentId);
    const index = siblings.findIndex((p) => p.id === id) + 1;
    const copyOf = (blocks: Block[]) =>
      blocks.map((block) => ({ ...block, id: newId() }));
    const copy: WorkspacePage = {
      ...source,
      id: copyId,
      title: source.title ? `${source.title} (copy)` : "",
      order: orderAt(
        siblings.map((p) => p.order),
        index,
      ),
      blocks: copyOf(source.blocks),
      createdAt: now,
      updatedAt: now,
    };
    setPage(copy, 0);
    structuralCall(async (api) => {
      await get().ensurePage(id);
      const blocks =
        get().loaded[id] !== undefined
          ? copyOf(get().workspace.pages[id]?.blocks ?? [])
          : copy.blocks;
      const { page } = pageResponseSchema.parse(
        await api.post(`${ROOT}/pages`, {
          id: copyId,
          title: copy.title,
          icon: copy.icon,
          parentId: copy.parentId,
          index,
          blocks,
          fullWidth: copy.fullWidth,
        }),
      );
      confirmed.delete(copyId);
      adoptDoc(page);
    }, copyId);
    return copyId;
  },

  trashPage: (id) => {
    if (id === HOME_PAGE_ID) return;
    const now = new Date().toISOString();
    const ids = new Set(descendantIds(get().workspace.pages, id));
    setPages((pages) => {
      const next = { ...pages };
      for (const pid of ids) {
        const page = next[pid];
        if (page && !page.deletedAt) next[pid] = { ...page, deletedAt: now };
      }
      return next;
    });
    const refs = new Set([...ids].map(pageRef));
    if (get().workspace.favorites.some((ref) => refs.has(ref))) {
      setPrefs((ws) => ({
        favorites: ws.favorites.filter((ref) => !refs.has(ref)),
      }));
    }
    structuralCall(async (api) =>
      adoptSummaries(await api.post(pagePath(id, "/archive"))),
    );
  },

  restorePage: (id) => {
    const pages = get().workspace.pages;
    const page = pages[id];
    if (!page) return;
    setPages((current) => {
      const next = { ...current };
      for (const pid of descendantIds(current, id)) {
        const p = next[pid];
        if (p) next[pid] = { ...p, deletedAt: null };
      }
      // A parent that is itself still in the trash cannot hold it.
      const parent = page.parentId ? next[page.parentId] : null;
      if (page.parentId && (!parent || parent.deletedAt)) {
        const top = siblingOrders(next, null, id);
        next[id] = {
          ...(next[id] ?? page),
          parentId: null,
          order: orderAt(top, top.length),
        };
      }
      return next;
    });
    structuralCall(async (api) =>
      adoptSummaries(await api.post(pagePath(id, "/restore"))),
    );
  },

  deletePageForever: (id) => {
    if (id === HOME_PAGE_ID) return;
    const ids = descendantIds(get().workspace.pages, id);
    dropPages(ids);
    structuralCall((api) => api.del(pagePath(id)));
  },

  emptyTrash: () => {
    const pages = get().workspace.pages;
    const trashed = Object.values(pages).filter((p) => p.deletedAt);
    const roots = trashed.filter(
      (p) => !p.parentId || !pages[p.parentId]?.deletedAt,
    );
    dropPages(trashed.map((p) => p.id));
    structuralCall(async (api) => {
      for (const root of roots) await api.del(pagePath(root.id));
    });
  },

  movePage: (id, parentId, index) => {
    if (id === HOME_PAGE_ID && parentId !== null) return;
    const pages = get().workspace.pages;
    const page = pages[id];
    if (!page) return;
    if (parentId && descendantIds(pages, id).includes(parentId)) return;
    const order = orderAt(siblingOrders(pages, parentId, id), index);
    setPage({ ...page, parentId, order });
    structuralCall(async (api) =>
      adoptResponseDoc(
        await api.post(pagePath(id, "/move"), { parentId, index }),
      ),
    );
  },

  addBlock: (pageId, block, index) => {
    const blocks = get().workspace.pages[pageId]?.blocks ?? [];
    editPage(pageId, [
      { op: "insert", block, after: anchorFor(blocks, index) },
    ]);
  },

  updateBlock: (pageId, block) =>
    editPage(pageId, [
      { op: "update", id: block.id, set: blockFields(block), replace: true },
    ]),

  removeBlock: (pageId, blockId) =>
    editPage(pageId, [{ op: "delete", id: blockId }]),

  duplicateBlock: (pageId, blockId) => {
    const source = get().workspace.pages[pageId]?.blocks.find(
      (b) => b.id === blockId,
    );
    if (!source) return;
    editPage(pageId, [
      { op: "insert", block: { ...source, id: newId() }, after: blockId },
    ]);
  },

  moveBlock: (pageId, from, to) => {
    const blocks = get().workspace.pages[pageId]?.blocks ?? [];
    const block = blocks[from];
    if (!block || from === to) return;
    const next = arrayMove(blocks, from, to);
    const at = next.findIndex((b) => b.id === block.id);
    editPage(pageId, [
      {
        op: "move",
        id: block.id,
        after: at > 0 ? (next[at - 1]?.id ?? null) : null,
      },
    ]);
  },

  setBlockSpan: (pageId, blockId, span) =>
    editPage(pageId, [{ op: "update", id: blockId, set: { span } }]),

  toggleFavorite: (ref) =>
    setPrefs((ws) => ({
      favorites: ws.favorites.includes(ref)
        ? ws.favorites.filter((f) => f !== ref)
        : [...ws.favorites, ref],
    })),

  moveFavorite: (from, to) =>
    setPrefs((ws) => ({ favorites: arrayMove(ws.favorites, from, to) })),

  recordVisit: (ref) => {
    if (get().workspace.recents[0] === ref) return;
    setPrefs((ws) => ({
      recents: [ref, ...ws.recents.filter((r) => r !== ref)].slice(
        0,
        MAX_RECENTS,
      ),
    }));
  },

  setSidebar: (patch) =>
    setPrefs((ws) => {
      const sidebar = { ...ws.sidebar, ...patch };
      sidebar.width = Math.min(
        SIDEBAR_MAX_WIDTH,
        Math.max(SIDEBAR_MIN_WIDTH, Math.round(sidebar.width)),
      );
      return { sidebar };
    }),

  toggleSidebar: () =>
    setPrefs((ws) => ({
      sidebar: { ...ws.sidebar, collapsed: !ws.sidebar.collapsed },
    })),

  toggleSection: (sectionId) =>
    setPrefs((ws) => {
      const list = ws.sidebar.collapsedSections;
      return {
        sidebar: {
          ...ws.sidebar,
          collapsedSections: list.includes(sectionId)
            ? list.filter((s) => s !== sectionId)
            : [...list, sectionId],
        },
      };
    }),

  toggleExpanded: (pageId) =>
    setPrefs((ws) => {
      const list = ws.sidebar.expandedPages;
      return {
        sidebar: {
          ...ws.sidebar,
          expandedPages: list.includes(pageId)
            ? list.filter((s) => s !== pageId)
            : [...list, pageId],
        },
      };
    }),

  setModuleHidden: (moduleId, hidden) =>
    setPrefs((ws) => {
      const list = ws.sidebar.hiddenModules.filter((m) => m !== moduleId);
      return {
        sidebar: {
          ...ws.sidebar,
          hiddenModules: hidden ? [...list, moduleId] : list,
        },
      };
    }),
}));
