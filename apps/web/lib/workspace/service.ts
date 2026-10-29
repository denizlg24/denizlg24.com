import {
  type Block,
  HOME_PAGE_ID,
  pageSchema,
  SIDEBAR_DEFAULT_WIDTH,
  type SidebarPrefs,
  sidebarPrefsSchema,
  type Workspace,
  type WorkspaceActor,
  type WorkspaceAppliedOp,
  type WorkspaceChanges,
  type WorkspaceOp,
  type WorkspaceOpsRequest,
  type WorkspacePage,
  type WorkspacePageCreate,
  type WorkspacePageDoc,
  type WorkspacePageMove,
  type WorkspacePageSummary,
  type WorkspacePrefs,
  type WorkspacePrefsInput,
  type WorkspaceRevisionKind,
  type WorkspaceRevisionSummary,
  workspacePageCreateSchema,
  workspaceRefSchema,
} from "@repo/schemas";
import {
  blocksToMarkdown,
  markdownToBlocks,
  WorkspaceMarkdownError,
} from "@repo/utils/workspace-markdown";
import {
  type AppliedOps,
  applyWorkspaceOps,
  deepEqual,
  diffWorkspacePages,
  orderAt,
  WorkspaceOpError,
} from "@repo/utils/workspace-ops";
import { z } from "zod";
import type {
  StoredPage,
  StoredPrefs,
  StoredRevision,
  WorkspaceRepo,
} from "./repo";

/** Every Nth revision carries the whole page, so a past rev rebuilds from near it. */
export const SNAPSHOT_EVERY = 20;
const TRASH_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
/** Containers' clocks may disagree a little; the feed re-reads this much before `since`. */
export const FEED_OVERLAP_MS = 5_000;
const CAS_ATTEMPTS = 5;
const HISTORY_SETTLE_MS = [5, 20, 50, 100];
const MARKDOWN_CONTEXT_MAX = 24_000;

export class WorkspaceError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "WorkspaceError";
  }
}

/** Who is calling, as `workspaceCaller` resolves it from the request. */
export interface WorkspaceCaller {
  actor: WorkspaceActor;
  /** The credential an agent actor arrived on, e.g. `mcp:<clientId>`. */
  via: string | null;
  /** Anything but the owner's own session: refused on locked pages. */
  agent: boolean;
}

export const OWNER: WorkspaceCaller = {
  actor: "owner",
  via: null,
  agent: false,
};

export function pageOf(stored: WorkspacePage): WorkspacePage {
  return {
    id: stored.id,
    title: stored.title,
    icon: stored.icon,
    parentId: stored.parentId,
    order: stored.order,
    blocks: stored.blocks,
    fullWidth: stored.fullWidth,
    locked: stored.locked,
    createdAt: stored.createdAt,
    updatedAt: stored.updatedAt,
    deletedAt: stored.deletedAt,
  };
}

export function docOf(stored: StoredPage): WorkspacePageDoc {
  return { ...pageOf(stored), rev: stored.rev };
}

export function summaryOf(stored: StoredPage): WorkspacePageSummary {
  const { blocks, ...meta } = pageOf(stored);
  return { ...meta, rev: stored.rev, blockCount: blocks.length };
}

function revisionSummary(revision: StoredRevision): WorkspaceRevisionSummary {
  return {
    rev: revision.rev,
    actor: revision.actor,
    via: revision.via,
    kind: revision.kind,
    at: revision.at.toISOString(),
    opCount: revision.ops.length,
    touched: revision.touched,
    snapshot: revision.snapshot !== null,
  };
}

/** A page without the server's own stamps, for "did anything change". */
function contentOf(
  page: WorkspacePage,
): Omit<WorkspacePage, "createdAt" | "updatedAt"> {
  const { createdAt: _c, updatedAt: _u, ...content } = page;
  return content;
}

function defaultSidebar(): SidebarPrefs {
  return {
    width: SIDEBAR_DEFAULT_WIDTH,
    collapsed: false,
    hiddenModules: [],
    collapsedSections: [],
    expandedPages: [HOME_PAGE_ID],
  };
}

function prefsInputOf(prefs: WorkspacePrefs): WorkspacePrefsInput {
  return {
    favorites: prefs.favorites,
    recents: prefs.recents,
    sidebar: prefs.sidebar,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Ids of `id` and every page beneath it. */
function descendants(pages: readonly StoredPage[], id: string): string[] {
  const out = [id];
  for (let i = 0; i < out.length; i++) {
    for (const page of pages) {
      if (page.parentId === out[i] && !out.includes(page.id)) out.push(page.id);
    }
  }
  return out;
}

/**
 * `id` and every page beneath it. A subtree write checks all of them before
 * writing any, so a locked page deep inside refuses the whole write rather
 * than leaving it half done.
 */
function subtree(pages: readonly StoredPage[], id: string): StoredPage[] {
  return descendants(pages, id).flatMap((pid) => {
    const page = pages.find((p) => p.id === pid);
    return page ? [page] : [];
  });
}

function siblingOrders(
  pages: readonly StoredPage[],
  parentId: string | null,
  except: string,
): number[] {
  return pages
    .filter((p) => p.parentId === parentId && !p.deletedAt && p.id !== except)
    .map((p) => p.order)
    .sort((a, b) => a - b);
}

/** The block ids an op is about; its anchor is not, since moving next to an edited block is fine. */
function targetIds(op: WorkspaceAppliedOp): string[] {
  switch (op.op) {
    case "insert":
      return [op.block.id];
    case "update":
    case "move":
    case "delete":
      return [op.id];
    case "page":
      return [];
    case "replace":
      return op.blocks.map((block) => block.id);
  }
}

function combine(first: AppliedOps, second: AppliedOps): AppliedOps {
  return {
    page: second.page,
    applied: [...first.applied, ...second.applied],
    inverse: [...second.inverse, ...first.inverse],
    touched: [...new Set([...first.touched, ...second.touched])],
    skipped: second.skipped,
  };
}

const META_KEYS = [
  "title",
  "icon",
  "fullWidth",
  "locked",
  "parentId",
  "order",
  "deletedAt",
] as const;

/**
 * Desktop 3.0.0's edits since `base`, kept only where nobody else changed the
 * same thing since: a three-way merge per block and per page field, with the
 * stored copy winning every collision.
 */
export function compatMergeOps(
  base: WorkspacePage,
  stored: WorkspacePage,
  incoming: WorkspacePage,
): WorkspaceAppliedOp[] {
  const storedById = new Map(stored.blocks.map((b) => [b.id, b]));
  const baseById = new Map(base.blocks.map((b) => [b.id, b]));
  const unchanged = (id: string) => {
    const now = storedById.get(id);
    const then = baseById.get(id);
    return now !== undefined && then !== undefined && deepEqual(now, then);
  };
  const deleted = new Set<string>();
  const out: WorkspaceAppliedOp[] = [];
  for (const op of diffWorkspacePages(base, incoming)) {
    switch (op.op) {
      case "page": {
        const set: Extract<WorkspaceAppliedOp, { op: "page" }>["set"] = {};
        let any = false;
        for (const key of META_KEYS) {
          if (op.set[key] !== undefined && stored[key] === base[key]) {
            Object.assign(set, { [key]: op.set[key] });
            any = true;
          }
        }
        if (any) out.push({ op: "page", set });
        break;
      }
      case "delete":
        if (unchanged(op.id)) {
          deleted.add(op.id);
          out.push(op);
        }
        break;
      case "update":
        if (unchanged(op.id)) out.push(op);
        break;
      case "insert":
        if (!storedById.has(op.block.id) || deleted.has(op.block.id)) {
          out.push(op);
        }
        break;
      case "move":
        if (storedById.has(op.id)) out.push(op);
        break;
      case "replace":
        break;
    }
  }
  return out;
}

export interface WorkspaceServiceOptions {
  now?: () => Date;
  newId?: () => string;
}

export type WorkspaceService = ReturnType<typeof createWorkspaceService>;

export function createWorkspaceService(
  repo: WorkspaceRepo,
  options: WorkspaceServiceOptions = {},
) {
  const now = options.now ?? (() => new Date());
  const newId =
    options.newId ?? (() => crypto.randomUUID().replace(/-/g, "").slice(0, 12));
  let migrated = false;

  function conflict(
    stored: StoredPage,
    conflicts: string[],
    message = "The page changed since baseRev",
  ): WorkspaceError {
    return new WorkspaceError(409, "CONFLICT", message, {
      conflicts,
      page: docOf(stored),
    });
  }

  async function load(id: string): Promise<StoredPage> {
    const page = await repo.getPage(id);
    if (!page || page.purgedAt) {
      throw new WorkspaceError(404, "NOT_FOUND", `No page ${id}`);
    }
    return page;
  }

  function assertWritable(page: StoredPage, caller: WorkspaceCaller) {
    if (page.locked && caller.agent) {
      throw new WorkspaceError(
        423,
        "LOCKED",
        `Page ${page.id} is locked; only the owner can change it`,
      );
    }
  }

  function applyStrict(
    page: WorkspacePage,
    ops: readonly WorkspaceAppliedOp[],
  ): AppliedOps {
    try {
      return applyWorkspaceOps(page, ops);
    } catch (error) {
      if (error instanceof WorkspaceOpError) {
        throw new WorkspaceError(400, error.code, error.message, {
          blockId: error.blockId,
        });
      }
      throw error;
    }
  }

  /** Writes `result` as the next rev; null when another write landed first. */
  async function commit(
    stored: StoredPage,
    result: AppliedOps,
    caller: WorkspaceCaller,
    kind: WorkspaceRevisionKind,
    snapshot = false,
  ): Promise<StoredPage | null> {
    const at = now();
    const next: StoredPage = {
      ...stored,
      ...result.page,
      id: stored.id,
      createdAt: stored.createdAt,
      updatedAt: at.toISOString(),
      rev: stored.rev + 1,
      changedAt: at,
    };
    if (!(await repo.replacePage(stored.rev, next))) return null;
    await repo.insertRevision({
      pageId: stored.id,
      rev: next.rev,
      actor: caller.actor,
      via: caller.via,
      kind,
      at,
      ops: result.applied,
      inverse: result.inverse,
      touched: result.touched,
      snapshot:
        snapshot || next.rev % SNAPSHOT_EVERY === 0 ? pageOf(next) : null,
    });
    return next;
  }

  /** Re-reads and retries until a compare-and-set lands. */
  async function retrying<T>(attempt: () => Promise<T | null>): Promise<T> {
    for (let i = 0; i < CAS_ATTEMPTS; i++) {
      const result = await attempt();
      if (result !== null) return result;
    }
    throw new WorkspaceError(
      409,
      "CONTENTION",
      "The page kept changing; retry",
    );
  }

  /** One page op on the current rev; meta never conflicts, the last write wins. */
  function writeMeta(
    id: string,
    set: Extract<WorkspaceAppliedOp, { op: "page" }>["set"],
    caller: WorkspaceCaller,
    kind: WorkspaceRevisionKind,
  ): Promise<StoredPage> {
    return retrying(async () => {
      const stored = await load(id);
      assertWritable(stored, caller);
      const result = applyStrict(pageOf(stored), [{ op: "page", set }]);
      if (deepEqual(contentOf(result.page), contentOf(pageOf(stored)))) {
        return stored;
      }
      return commit(stored, result, caller, kind);
    });
  }

  async function purgeOne(stored: StoredPage): Promise<void> {
    const at = now();
    const tombstone: StoredPage = {
      ...stored,
      blocks: [],
      rev: stored.rev + 1,
      updatedAt: at.toISOString(),
      changedAt: at,
      purgedAt: at,
      compatBase: null,
    };
    if (await repo.replacePage(stored.rev, tombstone)) {
      await repo.deleteRevisions(stored.id);
    }
  }

  /**
   * Revisions in (after, upTo]. `commit` writes the page first and its
   * revision a round trip later, so a reader can hold a rev the log does not
   * have yet; a short tail is re-read before it counts as missing. Callers
   * decide what a gap that outlasts this means.
   */
  async function revisionsThrough(
    id: string,
    after: number,
    upTo: number,
  ): Promise<StoredRevision[]> {
    let revisions = await repo.revisionsAfter(id, after, upTo);
    for (const wait of HISTORY_SETTLE_MS) {
      if (revisions.length >= upTo - after) break;
      await new Promise((resolve) => setTimeout(resolve, wait));
      revisions = await repo.revisionsAfter(id, after, upTo);
    }
    return revisions;
  }

  async function reconstruct(id: string, rev: number): Promise<WorkspacePage> {
    const base = await repo.latestSnapshot(id, rev);
    if (!base?.snapshot) {
      throw new WorkspaceError(
        410,
        "HISTORY_UNAVAILABLE",
        `No history for rev ${rev}`,
      );
    }
    const since = await revisionsThrough(id, base.rev, rev);
    if (since.length !== rev - base.rev) {
      throw new WorkspaceError(
        410,
        "HISTORY_UNAVAILABLE",
        `History before rev ${rev} is incomplete`,
      );
    }
    let page = base.snapshot;
    for (const revision of since) {
      page = applyWorkspaceOps(page, revision.ops).page;
    }
    return page;
  }

  function parseMarkdown(markdown: string): Block[] {
    try {
      return markdownToBlocks(markdown, { newId });
    } catch (error) {
      if (error instanceof WorkspaceMarkdownError) {
        throw new WorkspaceError(400, "INVALID_MARKDOWN", error.message, {
          line: error.line,
        });
      }
      throw error;
    }
  }

  const service = {
    /**
     * Splits the v1 `DesktopWorkspace` singleton into pages and prefs the
     * first time anything asks. Prefs are written last and mark completion;
     * pages and their first revision are insert-only, so a run that died
     * half-way, or two racing, finish with the same result. The v1 document
     * is read, never written.
     */
    async ensureMigrated(): Promise<void> {
      if (migrated) return;
      if (await repo.getPrefs()) {
        migrated = true;
        return;
      }
      const legacy = await repo.loadLegacy();
      const record = isRecord(legacy) ? legacy : {};
      const at = now();
      const rawPages = isRecord(record.pages)
        ? Object.values(record.pages)
        : [];
      for (const raw of rawPages) {
        const parsed = pageSchema.safeParse(raw);
        if (!parsed.success) {
          console.warn("Skipping an unreadable v1 workspace page");
          continue;
        }
        const page = parsed.data;
        await repo.insertPage({
          ...page,
          rev: 1,
          changedAt: at,
          purgedAt: null,
          compatBase: null,
        });
        await repo.insertRevision({
          pageId: page.id,
          rev: 1,
          actor: "owner",
          via: "migration",
          kind: "migrate",
          at,
          ops: [],
          inverse: [],
          touched: [],
          snapshot: page,
        });
      }
      const refs = z.array(workspaceRefSchema);
      const favorites = refs.safeParse(record.favorites);
      const recents = refs.safeParse(record.recents);
      const sidebar = sidebarPrefsSchema.safeParse(record.sidebar);
      const savedAt =
        typeof record.savedAt === "string" ? record.savedAt : null;
      await repo.insertPrefs({
        favorites: favorites.success ? favorites.data : [],
        recents: recents.success ? recents.data : [],
        sidebar: sidebar.success ? sidebar.data : defaultSidebar(),
        updatedAt: savedAt ?? at.toISOString(),
        changedAt: at,
        compatBase: null,
        migratedAt: at,
        migratedFrom: savedAt,
      });
      migrated = true;
    },

    /** Every live page as a summary; trash older than 30 days is purged on the way. */
    async listPages(): Promise<WorkspacePageSummary[]> {
      const pages = await repo.listPages();
      const cutoff = now().getTime() - TRASH_RETENTION_MS;
      const live: StoredPage[] = [];
      for (const page of pages) {
        if (
          page.deletedAt &&
          page.id !== HOME_PAGE_ID &&
          Date.parse(page.deletedAt) < cutoff
        ) {
          await purgeOne(page);
        } else {
          live.push(page);
        }
      }
      return live.map(summaryOf);
    },

    async getPage(id: string): Promise<WorkspacePageDoc> {
      return docOf(await load(id));
    },

    async createPage(
      input: WorkspacePageCreate & { markdown?: string },
      caller: WorkspaceCaller,
    ): Promise<WorkspacePageDoc> {
      const parsed = workspacePageCreateSchema.parse(input);
      const id = parsed.id ?? newId();
      if (id === HOME_PAGE_ID && parsed.parentId !== null) {
        throw new WorkspaceError(400, "INVALID_PARENT", "Home has no parent");
      }
      const pages = await repo.listPages();
      if (parsed.parentId) {
        const parent = pages.find((p) => p.id === parsed.parentId);
        if (!parent) {
          throw new WorkspaceError(
            400,
            "INVALID_PARENT",
            `No page ${parsed.parentId}`,
          );
        }
      }
      const blocks =
        input.markdown !== undefined
          ? parseMarkdown(input.markdown)
          : parsed.blocks;
      const at = now();
      const empty: WorkspacePage = {
        id,
        title: parsed.title,
        icon: parsed.icon,
        parentId: parsed.parentId,
        order: 0,
        blocks: [],
        fullWidth: parsed.fullWidth,
        locked: parsed.locked,
        createdAt: at.toISOString(),
        updatedAt: at.toISOString(),
        deletedAt: null,
      };
      const filled = applyStrict(empty, [{ op: "replace", blocks }]);
      const siblings = siblingOrders(pages, parsed.parentId, id);
      const page: WorkspacePage = {
        ...filled.page,
        order: orderAt(siblings, parsed.index ?? siblings.length),
      };
      const stored: StoredPage = {
        ...page,
        rev: 1,
        changedAt: at,
        purgedAt: null,
        compatBase: null,
      };
      if (!(await repo.insertPage(stored))) {
        throw new WorkspaceError(409, "EXISTS", `Page ${id} already exists`);
      }
      await repo.insertRevision({
        pageId: id,
        rev: 1,
        actor: caller.actor,
        via: caller.via,
        kind: "create",
        at,
        ops: filled.applied,
        inverse: [],
        touched: filled.touched,
        snapshot: page,
      });
      return docOf(stored);
    },

    async updateMeta(
      id: string,
      set: Extract<WorkspaceOp, { op: "page" }>["set"],
      caller: WorkspaceCaller,
    ): Promise<WorkspacePageDoc> {
      return docOf(await writeMeta(id, set, caller, "meta"));
    },

    async movePage(
      id: string,
      move: WorkspacePageMove,
      caller: WorkspaceCaller,
    ): Promise<WorkspacePageDoc> {
      if (id === HOME_PAGE_ID && move.parentId !== null) {
        throw new WorkspaceError(400, "INVALID_PARENT", "Home has no parent");
      }
      const pages = await repo.listPages();
      if (move.parentId !== null) {
        const parent = pages.find((p) => p.id === move.parentId);
        if (!parent || parent.deletedAt) {
          throw new WorkspaceError(
            400,
            "INVALID_PARENT",
            `No page ${move.parentId}`,
          );
        }
        if (descendants(pages, id).includes(move.parentId)) {
          throw new WorkspaceError(
            400,
            "INVALID_PARENT",
            "A page cannot move under itself",
          );
        }
      }
      const siblings = siblingOrders(pages, move.parentId, id);
      const order = orderAt(siblings, move.index ?? siblings.length);
      return docOf(
        await writeMeta(id, { parentId: move.parentId, order }, caller, "move"),
      );
    },

    /** Trashes the page and everything beneath it. */
    async archivePage(
      id: string,
      caller: WorkspaceCaller,
    ): Promise<WorkspacePageSummary[]> {
      if (id === HOME_PAGE_ID) {
        throw new WorkspaceError(400, "HOME", "Home cannot be archived");
      }
      await load(id);
      const pages = await repo.listPages();
      const targets = subtree(pages, id).filter((page) => !page.deletedAt);
      for (const page of targets) assertWritable(page, caller);
      const deletedAt = now().toISOString();
      const changed: WorkspacePageSummary[] = [];
      for (const page of targets) {
        changed.push(
          summaryOf(await writeMeta(page.id, { deletedAt }, caller, "archive")),
        );
      }
      return changed;
    },

    /** Brings the page and its subtree back; to the top level when its parent is gone. */
    async restorePage(
      id: string,
      caller: WorkspaceCaller,
    ): Promise<WorkspacePageSummary[]> {
      const root = await load(id);
      assertWritable(root, caller);
      const pages = await repo.listPages();
      const writes: {
        page: StoredPage;
        set: Extract<WorkspaceAppliedOp, { op: "page" }>["set"];
      }[] = [];
      for (const page of subtree(pages, id)) {
        const set: Extract<WorkspaceAppliedOp, { op: "page" }>["set"] = {};
        if (page.deletedAt) set.deletedAt = null;
        if (page.id === id && page.parentId) {
          const parent = pages.find((p) => p.id === page.parentId);
          if (!parent || parent.deletedAt) {
            set.parentId = null;
            const top = siblingOrders(pages, null, id);
            set.order = orderAt(top, top.length);
          }
        }
        if (Object.keys(set).length > 0) writes.push({ page, set });
      }
      for (const { page } of writes) assertWritable(page, caller);
      const changed: WorkspacePageSummary[] = [];
      for (const { page, set } of writes) {
        changed.push(
          summaryOf(await writeMeta(page.id, set, caller, "restore")),
        );
      }
      return changed;
    },

    /** Deletes a trashed page and its subtree for good, history included. */
    async purgePage(id: string, caller: WorkspaceCaller): Promise<string[]> {
      if (id === HOME_PAGE_ID) {
        throw new WorkspaceError(400, "HOME", "Home cannot be deleted");
      }
      const root = await load(id);
      assertWritable(root, caller);
      if (!root.deletedAt) {
        throw new WorkspaceError(409, "NOT_ARCHIVED", "Archive the page first");
      }
      const pages = await repo.listPages();
      const targets = subtree(pages, id);
      for (const page of targets) assertWritable(page, caller);
      for (const page of targets) await purgeOne(page);
      return descendants(pages, id);
    },

    /**
     * Applies a batch. Written against the current rev it applies as is;
     * against an older one it rebases when no revision since touched any
     * block the batch targets, and is refused with the current page when one
     * did. Page-field ops never conflict.
     */
    async applyOps(
      id: string,
      request: WorkspaceOpsRequest,
      caller: WorkspaceCaller,
    ): Promise<WorkspacePageDoc> {
      return docOf(
        await retrying(async () => {
          const stored = await load(id);
          assertWritable(stored, caller);
          if (request.baseRev > stored.rev) {
            throw conflict(stored, [], "baseRev is ahead of the page");
          }
          const rebasing = request.baseRev < stored.rev;
          if (rebasing) {
            const since = await revisionsThrough(
              id,
              request.baseRev,
              stored.rev,
            );
            if (since.length !== stored.rev - request.baseRev) {
              throw conflict(stored, [], "History since baseRev is incomplete");
            }
            const touched = new Set(since.flatMap((r) => r.touched));
            const conflicts = [
              ...new Set(request.ops.flatMap(targetIds)),
            ].filter((blockId) => touched.has(blockId));
            if (conflicts.length > 0) throw conflict(stored, conflicts);
          }
          let result: AppliedOps;
          try {
            result = applyWorkspaceOps(pageOf(stored), request.ops);
          } catch (error) {
            if (error instanceof WorkspaceOpError) {
              if (rebasing) {
                throw conflict(stored, error.blockId ? [error.blockId] : []);
              }
              throw new WorkspaceError(400, error.code, error.message, {
                blockId: error.blockId,
              });
            }
            throw error;
          }
          return commit(stored, result, caller, "ops");
        }),
      );
    },

    async history(
      id: string,
      options: { limit: number; before?: number },
    ): Promise<WorkspaceRevisionSummary[]> {
      await load(id);
      return (await repo.listRevisions(id, options)).map(revisionSummary);
    },

    /** The page's blocks and fields as they stood at `rev`; its place in the tree stays. */
    async revertToRev(
      id: string,
      rev: number,
      caller: WorkspaceCaller,
    ): Promise<WorkspacePageDoc> {
      return docOf(
        await retrying(async () => {
          const stored = await load(id);
          assertWritable(stored, caller);
          if (rev > stored.rev) {
            throw new WorkspaceError(
              400,
              "INVALID_REV",
              `The page is at rev ${stored.rev}`,
            );
          }
          const then = await reconstruct(id, rev);
          const current = pageOf(stored);
          const ops = diffWorkspacePages(current, {
            ...current,
            blocks: then.blocks,
            title: then.title,
            icon: then.icon,
            fullWidth: then.fullWidth,
            locked: then.locked,
          });
          if (ops.length === 0) return stored;
          return commit(
            stored,
            applyStrict(current, ops),
            caller,
            "revert",
            true,
          );
        }),
      );
    },

    /**
     * Undoes `actor`'s revisions after `sinceRev`, newest first. An undo
     * that would land on a block someone else touched later is skipped, so
     * reverting an agent never throws away the owner's edits made after it.
     */
    async revertActor(
      id: string,
      actor: WorkspaceActor,
      sinceRev: number,
      caller: WorkspaceCaller,
    ): Promise<{ page: WorkspacePageDoc; reverted: number; skipped: number }> {
      return retrying(async () => {
        const stored = await load(id);
        assertWritable(stored, caller);
        const revisions = await revisionsThrough(id, sinceRev, stored.rev);
        const laterOthers = new Set<string>();
        const ops: WorkspaceAppliedOp[] = [];
        let skipped = 0;
        for (const revision of revisions.slice().reverse()) {
          if (revision.actor !== actor) {
            for (const blockId of revision.touched) laterOthers.add(blockId);
            continue;
          }
          for (const op of revision.inverse) {
            if (targetIds(op).some((blockId) => laterOthers.has(blockId))) {
              skipped++;
            } else {
              ops.push(op);
            }
          }
        }
        if (ops.length === 0) {
          return { page: docOf(stored), reverted: 0, skipped };
        }
        const result = applyWorkspaceOps(pageOf(stored), ops, {
          lenient: true,
        });
        skipped += result.skipped.length;
        if (result.applied.length === 0) {
          return { page: docOf(stored), reverted: 0, skipped };
        }
        const next = await commit(stored, result, caller, "revert", true);
        return next
          ? { page: docOf(next), reverted: result.applied.length, skipped }
          : null;
      });
    },

    async toMarkdown(id: string) {
      const stored = await load(id);
      return {
        id: stored.id,
        rev: stored.rev,
        title: stored.title,
        locked: stored.locked,
        markdown: blocksToMarkdown(stored.blocks),
      };
    },

    /** Replaces the blocks with what `markdown` describes; ids in its markers are kept. */
    async fromMarkdown(
      id: string,
      baseRev: number,
      markdown: string,
      caller: WorkspaceCaller,
    ): Promise<WorkspacePageDoc> {
      const stored = await load(id);
      assertWritable(stored, caller);
      if (baseRev !== stored.rev) {
        throw conflict(stored, [], "from_markdown needs the current rev");
      }
      const current = pageOf(stored);
      const ops = diffWorkspacePages(current, {
        ...current,
        blocks: parseMarkdown(markdown),
      });
      if (ops.length === 0) return docOf(stored);
      const next = await commit(
        stored,
        applyStrict(current, ops),
        caller,
        "replace",
      );
      if (!next) throw conflict((await repo.getPage(id)) ?? stored, []);
      return docOf(next);
    },

    async changes(since: string | null): Promise<WorkspaceChanges> {
      const cursor = now().toISOString();
      const from = since ? Date.parse(since) : 0;
      if (Number.isNaN(from)) {
        throw new WorkspaceError(
          400,
          "INVALID_SINCE",
          "since must be an ISO date",
        );
      }
      const changed = await repo.pagesChangedSince(
        new Date(Math.max(0, from - FEED_OVERLAP_MS)),
      );
      const prefs = await repo.getPrefs();
      return {
        cursor,
        pages: changed.filter((p) => !p.purgedAt).map(summaryOf),
        purged: changed.filter((p) => p.purgedAt).map((p) => p.id),
        prefsUpdatedAt: prefs?.updatedAt ?? null,
      };
    },

    async getPrefs(): Promise<WorkspacePrefs> {
      const prefs = await repo.getPrefs();
      if (!prefs)
        throw new WorkspaceError(500, "NOT_MIGRATED", "Prefs missing");
      return { ...prefsInputOf(prefs), updatedAt: prefs.updatedAt };
    },

    /** Prefs are the owner's alone: the last write wins. */
    async putPrefs(input: WorkspacePrefsInput): Promise<WorkspacePrefs> {
      const prefs = await repo.getPrefs();
      if (!prefs)
        throw new WorkspaceError(500, "NOT_MIGRATED", "Prefs missing");
      const at = now();
      const next: StoredPrefs = {
        ...prefs,
        ...input,
        updatedAt: at.toISOString(),
        changedAt: at,
      };
      await repo.savePrefs(next);
      return { ...prefsInputOf(next), updatedAt: next.updatedAt };
    },

    /** The open page for the agent's context: id, rev and markdown, bounded. */
    async pageContext(id: string) {
      const stored = await repo.getPage(id);
      if (!stored || stored.purgedAt) return null;
      const markdown = blocksToMarkdown(stored.blocks);
      return {
        id: stored.id,
        rev: stored.rev,
        title: stored.title,
        locked: stored.locked,
        markdown:
          markdown.length > MARKDOWN_CONTEXT_MAX
            ? `${markdown.slice(0, MARKDOWN_CONTEXT_MAX)}\n[truncated; read the rest with web_workspace_pages to_markdown]`
            : markdown,
      };
    },

    /**
     * `GET /workspace` for desktop 3.0.0: the whole v1 document assembled
     * from pages and prefs. Each page and the prefs remember what was served
     * as the base a later whole-document PUT is merged against, and `savedAt`
     * is the server's now, so 3.0.0 — which adopts the server copy only when
     * it is newer than its own — always adopts what it was given.
     */
    async compatGet(): Promise<Workspace> {
      const pages = await repo.listPages();
      for (const page of pages) {
        const content = pageOf(page);
        if (!deepEqual(page.compatBase, content)) {
          await repo.setCompatBase(page.id, content);
        }
      }
      const prefs = await repo.getPrefs();
      if (!prefs)
        throw new WorkspaceError(500, "NOT_MIGRATED", "Prefs missing");
      const input = prefsInputOf(prefs);
      await repo.savePrefs({ ...prefs, compatBase: input });
      return {
        version: 1,
        savedAt: now().toISOString(),
        pages: Object.fromEntries(pages.map((p) => [p.id, pageOf(p)])),
        ...input,
      };
    },

    /**
     * `PUT /workspace` from desktop 3.0.0, merged page by page against what
     * that client was last given (or last sent): only its own edits since
     * then apply, and only where nobody else changed the same block or page
     * field meanwhile — the stored copy wins every collision.
     */
    async compatPut(workspace: Workspace): Promise<void> {
      const incomingIds = new Set<string>();
      for (const incoming of Object.values(workspace.pages)) {
        incomingIds.add(incoming.id);
        await compatPage(incoming);
      }
      // A page 3.0.0 dropped is one it deleted for good — which it only does
      // to trashed pages. Anything changed since it last held it stays.
      for (const stored of await repo.listPages()) {
        if (
          incomingIds.has(stored.id) ||
          stored.id === HOME_PAGE_ID ||
          !stored.compatBase ||
          !stored.deletedAt
        ) {
          continue;
        }
        if (
          deepEqual(contentOf(pageOf(stored)), contentOf(stored.compatBase))
        ) {
          await purgeOne(stored);
        }
      }
      const prefs = await repo.getPrefs();
      if (!prefs) return;
      const incoming: WorkspacePrefsInput = {
        favorites: workspace.favorites,
        recents: workspace.recents,
        sidebar: workspace.sidebar,
      };
      const base = prefs.compatBase;
      const next: StoredPrefs = { ...prefs, compatBase: incoming };
      let changed = false;
      if (base) {
        for (const key of ["favorites", "recents", "sidebar"] as const) {
          if (
            deepEqual(prefs[key], base[key]) &&
            !deepEqual(prefs[key], incoming[key])
          ) {
            Object.assign(next, { [key]: incoming[key] });
            changed = true;
          }
        }
      }
      if (changed) {
        const at = now();
        next.updatedAt = at.toISOString();
        next.changedAt = at;
      }
      await repo.savePrefs(next);
    },
  };

  async function compatPage(incoming: WorkspacePage): Promise<void> {
    const existing = await repo.getPage(incoming.id);
    if (!existing) {
      const at = now();
      const page: WorkspacePage = { ...incoming, updatedAt: at.toISOString() };
      const inserted = await repo.insertPage({
        ...page,
        rev: 1,
        changedAt: at,
        purgedAt: null,
        compatBase: incoming,
      });
      if (inserted) {
        await repo.insertRevision({
          pageId: page.id,
          rev: 1,
          actor: "owner",
          via: "compat",
          kind: "compat",
          at,
          ops: [{ op: "replace", blocks: page.blocks }],
          inverse: [],
          touched: page.blocks.map((b) => b.id),
          snapshot: page,
        });
      }
      return;
    }
    if (existing.purgedAt || !existing.compatBase) return;
    const base = existing.compatBase;
    await retrying(async () => {
      const stored = await load(incoming.id);
      const ops = compatMergeOps(base, pageOf(stored), incoming);
      if (ops.length === 0) return stored;
      let result = applyWorkspaceOps(pageOf(stored), ops, { lenient: true });
      const orphans = result.skipped
        .filter((s) => s.code === "MISSING_ANCHOR" && s.op.op === "insert")
        .map((s) => s.op)
        .flatMap((op) =>
          op.op === "insert" ? [{ ...op, after: undefined }] : [],
        );
      if (orphans.length > 0) {
        result = combine(
          result,
          applyWorkspaceOps(result.page, orphans, { lenient: true }),
        );
      }
      if (result.applied.length === 0) return stored;
      return commit(stored, result, OWNER_COMPAT, "compat");
    });
    await repo.setCompatBase(incoming.id, incoming);
  }

  return service;
}

const OWNER_COMPAT: WorkspaceCaller = {
  actor: "owner",
  via: "compat",
  agent: false,
};
