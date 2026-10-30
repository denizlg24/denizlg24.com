import {
  type Block,
  HOME_PAGE_ID,
  type LegacyBlock,
  type LegacyPage,
  type LegacyWorkspace,
  legacyPageSchema,
  SIDEBAR_DEFAULT_WIDTH,
  type SidebarPrefs,
  sidebarPrefsSchema,
  type TemplateFromBlocks,
  type TemplateInsert,
  type TemplateInstantiate,
  templateFromBlocksSchema,
  templateInsertSchema,
  templateInstantiateSchema,
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
  type WorkspaceTemplateSummary,
  workspacePageCreateSchema,
  workspaceRefSchema,
} from "@repo/schemas";
import {
  downgradeBlocks,
  downgradePage,
  legacyBlockToFlow,
  upgradeLegacyBlocks,
  upgradeLegacyPage,
} from "@repo/utils/workspace-legacy";
import {
  blocksToMarkdown,
  markdownToBlocks,
  WorkspaceMarkdownError,
} from "@repo/utils/workspace-markdown";
import {
  type AppliedOps,
  applyWorkspaceOps,
  blockFields,
  deepEqual,
  diffWorkspacePages,
  orderAt,
  WorkspaceOpError,
} from "@repo/utils/workspace-ops";
import {
  fillTemplate,
  instantiateTemplateBlocks,
  type TemplateClock,
  templateInputNames,
  withFreshBlockIds,
} from "@repo/utils/workspace-templates";
import {
  ancestorIds,
  childrenOf,
  findBlock,
  treeIds,
} from "@repo/utils/workspace-tree";
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
    ...(stored.template ? { template: true } : {}),
  };
}

export function docOf(stored: StoredPage): WorkspacePageDoc {
  return { ...pageOf(stored), rev: stored.rev };
}

export function summaryOf(stored: StoredPage): WorkspacePageSummary {
  const { blocks, ...meta } = pageOf(stored);
  return {
    ...meta,
    rev: stored.rev,
    blockCount: stored.legacyBlocks?.length ?? blocks.length,
  };
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
function contentOf<T extends WorkspacePage | LegacyPage>(
  page: T,
): Omit<T, "createdAt" | "updatedAt"> {
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

/** Blocks a revision moved, removed or replaced: their subtrees changed place. */
function displacedIds(revision: StoredRevision): string[] {
  return revision.ops.flatMap((op) => {
    switch (op.op) {
      case "move":
      case "delete":
        return [op.id];
      case "replace":
        return revision.touched;
      default:
        return [];
    }
  });
}

/**
 * The blocks of `ops` that conflict with what landed since their base rev:
 * a target someone else touched, or one whose ancestors — where it sits now,
 * or where the op puts it — someone else moved or deleted.
 */
export function rebaseConflicts(
  blocks: readonly Block[],
  ops: readonly WorkspaceOp[],
  since: readonly StoredRevision[],
): string[] {
  const touched = new Set(since.flatMap((r) => r.touched));
  const displaced = new Set(since.flatMap(displacedIds));
  const conflicts = new Set<string>();
  for (const op of ops) {
    const destination =
      (op.op === "insert" || op.op === "move") && op.parentId
        ? [op.parentId, ...ancestorIds(blocks, op.parentId)]
        : [];
    for (const id of targetIds(op)) {
      const chain = [...ancestorIds(blocks, id), ...destination];
      if (touched.has(id) || chain.some((a) => displaced.has(a))) {
        conflicts.add(id);
      }
    }
  }
  return [...conflicts];
}

/**
 * Inserts placing `blocks` one after another: the first at `after` (absent
 * appends, null is first) under `parentId`, each next one after the last.
 */
export function insertSequence(
  blocks: readonly Block[],
  parentId: string | null | undefined,
  after: string | null | undefined,
): WorkspaceAppliedOp[] {
  let anchor = after;
  return blocks.map((block) => {
    const op: WorkspaceAppliedOp = {
      op: "insert",
      block,
      ...(parentId ? { parentId } : {}),
      ...(anchor !== undefined ? { after: anchor } : {}),
    };
    anchor = block.id;
    return op;
  });
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

function withoutSpan(block: LegacyBlock): Omit<LegacyBlock, "span"> {
  const { span: _span, ...rest } = block;
  return rest;
}

/**
 * Desktop 3.0.0's edits since it was served `base`, as ops on the stored
 * flow. 3.0.0 only ever sees the flow downgraded (`downgradePage`, one v1
 * block per flow block, same ids), so its PUT is diffed in that shape and
 * each difference applies only when the stored flow, downgraded the same
 * way, still reads as `base` there:
 *
 * - a v1 block whose content changed replaces its flow block in place (an
 *   update when it converts back to one block of the same type, otherwise
 *   the subtree is deleted and its conversion inserted where it stood);
 * - a v1 block that vanished deletes its flow block and subtree;
 * - a v1 block that is new is converted and inserted at the top level after
 *   the block 3.0.0 put before it;
 * - span and order changes are ignored: a grid cannot say where in the
 *   flow a block belongs, so it never moves one;
 * - page fields merge one by one, the stored value winning a collision.
 *
 * Throws `WorkspaceOpError` when the result cannot apply, and the caller
 * then applies nothing for the page.
 */
export function compatMergeOps(
  base: LegacyPage,
  stored: WorkspacePage,
  incoming: LegacyPage,
  newId: () => string,
): WorkspaceAppliedOp[] {
  const ops: WorkspaceAppliedOp[] = [];
  let working = stored;
  const emit = (op: WorkspaceAppliedOp) => {
    working = applyWorkspaceOps(working, [op]).page;
    ops.push(op);
  };

  const set: Extract<WorkspaceAppliedOp, { op: "page" }>["set"] = {};
  let metaChanged = false;
  for (const key of META_KEYS) {
    if (incoming[key] !== base[key] && stored[key] === base[key]) {
      Object.assign(set, { [key]: incoming[key] });
      metaChanged = true;
    }
  }
  if (metaChanged) emit({ op: "page", set });

  const baseById = new Map(base.blocks.map((b) => [b.id, b]));
  const storedById = new Map(
    downgradeBlocks(stored.blocks).map((b) => [b.id, b]),
  );
  const incomingIds = new Set(incoming.blocks.map((b) => b.id));
  const untouched = (id: string) => {
    const now = storedById.get(id);
    const then = baseById.get(id);
    return now !== undefined && then !== undefined && deepEqual(now, then);
  };
  const rootOf = (id: string) => {
    const chain = [id, ...ancestorIds(working.blocks, id)];
    return chain.at(-1) ?? id;
  };

  let anchor: string | null = null;
  for (const block of incoming.blocks) {
    const before = baseById.get(block.id);
    if (!before) {
      if (findBlock(working.blocks, block.id)) continue;
      for (const flow of legacyBlockToFlow(block, newId)) {
        emit({ op: "insert", block: flow, after: anchor });
        anchor = flow.id;
      }
      continue;
    }
    const location = findBlock(working.blocks, block.id);
    if (
      location &&
      !deepEqual(withoutSpan(block), withoutSpan(before)) &&
      untouched(block.id)
    ) {
      const replacement = legacyBlockToFlow(block, newId);
      const [only] = replacement;
      const current = location.block;
      if (
        replacement.length === 1 &&
        only &&
        only.id === current.id &&
        only.type === current.type &&
        deepEqual(childrenOf(only), childrenOf(current))
      ) {
        emit({
          op: "update",
          id: current.id,
          set: blockFields(only),
          replace: true,
        });
      } else {
        const after =
          location.index > 0
            ? (location.siblings[location.index - 1]?.id ?? null)
            : null;
        const parentId = location.parentId;
        emit({ op: "delete", id: current.id });
        let previous = after;
        for (const flow of replacement) {
          emit({
            op: "insert",
            block: flow,
            ...(parentId ? { parentId } : {}),
            after: previous,
          });
          previous = flow.id;
        }
      }
    }
    if (findBlock(working.blocks, block.id)) anchor = rootOf(block.id);
  }

  for (const block of base.blocks) {
    if (incomingIds.has(block.id) || !untouched(block.id)) continue;
    if (findBlock(working.blocks, block.id)) {
      emit({ op: "delete", id: block.id });
    }
  }
  return ops;
}

/** A page write that landed, for whatever follows writes (agent sections, domain events). */
export interface WorkspaceChange {
  page: StoredPage;
  /** The page before the write; null when it was just created. */
  previous: StoredPage | null;
  caller: WorkspaceCaller;
  kind: WorkspaceRevisionKind;
}

export interface WorkspaceServiceOptions {
  now?: () => Date;
  newId?: () => string;
  /** Called after each write lands; must not throw or block on slow work. */
  onChange?: (change: WorkspaceChange) => void;
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

  /**
   * Turns a page still holding its v1 grid into a flow, as one revision by
   * `migration`. Deterministic, so a racing reader that loses the
   * compare-and-set simply reads the winner's identical result.
   */
  async function migrate(stored: StoredPage): Promise<StoredPage> {
    const legacy = stored.legacyBlocks;
    if (!legacy) return stored;
    const at = now();
    const blocks = upgradeLegacyBlocks(legacy);
    const next: StoredPage = {
      ...stored,
      blocks,
      legacyBlocks: null,
      rev: stored.rev + 1,
      changedAt: at,
    };
    if (!(await repo.replacePage(stored.rev, next))) {
      const current = await repo.getPage(stored.id);
      if (!current) throw new WorkspaceError(404, "NOT_FOUND", stored.id);
      return current.legacyBlocks ? migrate(current) : current;
    }
    await repo.insertRevision({
      pageId: stored.id,
      rev: next.rev,
      actor: "migration",
      via: null,
      kind: "migrate",
      at,
      ops: [{ op: "replace", blocks }],
      inverse: [],
      touched: treeIds(blocks),
      snapshot: pageOf(next),
      legacy: null,
    });
    return next;
  }

  async function load(id: string): Promise<StoredPage> {
    const page = await repo.getPage(id);
    if (!page || page.purgedAt) {
      throw new WorkspaceError(404, "NOT_FOUND", `No page ${id}`);
    }
    return migrate(page);
  }

  async function loadTemplate(id: string): Promise<StoredPage> {
    const page = await load(id);
    if (!page.template || page.deletedAt) {
      throw new WorkspaceError(
        404,
        "NOT_TEMPLATE",
        `Page ${id} is no template`,
      );
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
    // `template` is present only when true, so the result decides it.
    const { template: _template, ...base } = stored;
    const next: StoredPage = {
      ...base,
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
      legacy: null,
    });
    notify({ page: next, previous: stored, caller, kind });
    return next;
  }

  function notify(change: WorkspaceChange) {
    try {
      options.onChange?.(change);
    } catch (error) {
      console.error("Workspace change listener failed:", error);
    }
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
      legacyBlocks: null,
      rev: stored.rev + 1,
      updatedAt: at.toISOString(),
      changedAt: at,
      purgedAt: at,
      compatBase: null,
    };
    if (await repo.replacePage(stored.rev, tombstone)) {
      await repo.setCompatBase(stored.id, null);
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
    // Restoring to a rev from before the flow converts that grid afresh.
    let page = base.legacy ? upgradeLegacyPage(base.legacy) : base.snapshot;
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
     * is read, never written. Each page keeps its grid in `legacyBlocks`
     * until its first read turns it into a flow (`migrate`).
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
        const parsed = legacyPageSchema.safeParse(raw);
        if (!parsed.success) {
          console.warn("Skipping an unreadable v1 workspace page");
          continue;
        }
        const page = parsed.data;
        await repo.insertPage({
          ...page,
          blocks: [],
          legacyBlocks: page.blocks,
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
          snapshot: { ...page, blocks: [] },
          legacy: page,
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
        ...(parsed.template ? { template: true } : {}),
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
        legacyBlocks: null,
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
        legacy: null,
      });
      notify({ page: stored, previous: null, caller, kind: "create" });
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
     * against an older one it rebases unless a revision since touched a
     * block the batch targets or moved or deleted one of its ancestors
     * (`rebaseConflicts`), and is refused with the current page when one
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
            const conflicts = rebaseConflicts(
              stored.blocks,
              request.ops,
              since,
            );
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

    /** Every live template, inputs listed, by title. */
    async listTemplates(): Promise<WorkspaceTemplateSummary[]> {
      const out: WorkspaceTemplateSummary[] = [];
      for (const listed of await repo.listPages()) {
        if (!listed.template || listed.deletedAt) continue;
        const page = await migrate(listed);
        out.push({
          id: page.id,
          title: page.title,
          icon: page.icon,
          inputs: templateInputNames(page.title, page.blocks),
          blockCount: page.blocks.length,
          updatedAt: page.updatedAt,
        });
      }
      return out.sort((a, b) => a.title.localeCompare(b.title));
    },

    /**
     * A new page from template `templateId`: its blocks with fresh ids and
     * variables filled, its icon and width, created as one revision by
     * `caller` like any other page.
     */
    async instantiateTemplate(
      templateId: string,
      input: TemplateInstantiate,
      caller: WorkspaceCaller,
      clock: TemplateClock,
    ): Promise<WorkspacePageDoc> {
      const parsed = templateInstantiateSchema.parse(input);
      const template = await loadTemplate(templateId);
      const base = {
        ...clock,
        inputs: parsed.inputs,
        pageTitle: template.title,
      };
      const title = fillTemplate(parsed.title ?? template.title, base);
      const blocks = instantiateTemplateBlocks(
        template.blocks,
        { ...base, pageTitle: title },
        newId,
      );
      return service.createPage(
        {
          title,
          icon: template.icon,
          parentId: parsed.parentId,
          ...(parsed.index !== undefined ? { index: parsed.index } : {}),
          blocks,
          fullWidth: template.fullWidth,
        },
        caller,
      );
    },

    /** Template `templateId`'s blocks inserted into a page, as one revision by `caller`. */
    async insertTemplate(
      templateId: string,
      input: TemplateInsert,
      caller: WorkspaceCaller,
      clock: TemplateClock,
    ): Promise<WorkspacePageDoc> {
      const parsed = templateInsertSchema.parse(input);
      const template = await loadTemplate(templateId);
      return docOf(
        await retrying(async () => {
          const stored = await load(parsed.pageId);
          assertWritable(stored, caller);
          const blocks = instantiateTemplateBlocks(
            template.blocks,
            { ...clock, inputs: parsed.inputs, pageTitle: stored.title },
            newId,
          );
          if (blocks.length === 0) return stored;
          return commit(
            stored,
            applyStrict(
              pageOf(stored),
              insertSequence(blocks, parsed.parentId, parsed.after),
            ),
            caller,
            "ops",
          );
        }),
      );
    },

    /**
     * `blocks` (ids new to the page) inserted at `place` on the current rev,
     * as one revision. What buttons and triggers write with.
     */
    async insertBlocks(
      pageId: string,
      blocks: readonly Block[],
      place: { parentId?: string | null; after?: string | null },
      caller: WorkspaceCaller,
    ): Promise<WorkspacePageDoc> {
      return docOf(
        await retrying(async () => {
          const stored = await load(pageId);
          assertWritable(stored, caller);
          if (blocks.length === 0) return stored;
          return commit(
            stored,
            applyStrict(
              pageOf(stored),
              insertSequence(blocks, place.parentId, place.after),
            ),
            caller,
            "ops",
          );
        }),
      );
    },

    /**
     * Replaces the children of container `parentId` with `blocks`, as one
     * revision. With `expected`, refuses (409 `EDITED`) when the children
     * are no longer exactly those — so a writer that decided on one version
     * never overwrites another.
     */
    async replaceChildren(
      pageId: string,
      parentId: string,
      blocks: readonly Block[],
      caller: WorkspaceCaller,
      expected?: readonly Block[],
    ): Promise<WorkspacePageDoc> {
      return docOf(
        await retrying(async () => {
          const stored = await load(pageId);
          assertWritable(stored, caller);
          const found = findBlock(stored.blocks, parentId);
          if (!found) {
            throw new WorkspaceError(
              404,
              "NO_BLOCK",
              `No block ${parentId} on page ${pageId}`,
            );
          }
          const children = childrenOf(found.block);
          if (expected !== undefined && !deepEqual(children, expected)) {
            throw new WorkspaceError(
              409,
              "EDITED",
              `Block ${parentId} changed since it was read`,
            );
          }
          const ops: WorkspaceAppliedOp[] = [
            ...children.map(
              (child): WorkspaceAppliedOp => ({
                op: "delete",
                id: child.id,
              }),
            ),
            ...insertSequence(blocks, parentId, undefined),
          ];
          if (ops.length === 0) return stored;
          return commit(
            stored,
            applyStrict(pageOf(stored), ops),
            caller,
            "ops",
          );
        }),
      );
    },

    /** Checks or unchecks one to-do on the current rev. */
    async setTodo(
      pageId: string,
      blockId: string,
      checked: boolean,
      caller: WorkspaceCaller,
    ): Promise<WorkspacePageDoc> {
      return docOf(
        await retrying(async () => {
          const stored = await load(pageId);
          assertWritable(stored, caller);
          const found = findBlock(stored.blocks, blockId);
          if (found?.block.type !== "todo") {
            throw new WorkspaceError(
              400,
              "NOT_TODO",
              `No to-do ${blockId} on page ${pageId}`,
            );
          }
          if (found.block.checked === checked) return stored;
          return commit(
            stored,
            applyStrict(pageOf(stored), [
              { op: "update", id: blockId, set: { checked } },
            ]),
            caller,
            "ops",
          );
        }),
      );
    },

    /** A new template page holding copies of blocks from a page, in document order. */
    async templateFromBlocks(
      input: TemplateFromBlocks,
      caller: WorkspaceCaller,
    ): Promise<WorkspacePageDoc> {
      const parsed = templateFromBlocksSchema.parse(input);
      const source = await load(parsed.pageId);
      const wanted = new Set(parsed.blockIds);
      const picked: Block[] = [];
      const visit = (blocks: readonly Block[]) => {
        for (const block of blocks) {
          if (!wanted.has(block.id)) visit(childrenOf(block));
          else if (block.type === "column") picked.push(...block.children);
          else picked.push(block);
        }
      };
      visit(source.blocks);
      if (picked.length === 0) {
        throw new WorkspaceError(
          400,
          "NO_BLOCKS",
          "None of those blocks are on the page",
        );
      }
      return service.createPage(
        {
          title: parsed.title,
          parentId: null,
          blocks: withFreshBlockIds(picked, newId),
          template: true,
        },
        caller,
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
      const found = await repo.getPage(id);
      if (!found || found.purgedAt) return null;
      const stored = await migrate(found);
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
     * from pages and prefs, each flow downgraded to a grid
     * (`downgradePage`). Each page and the prefs remember what was served as
     * the base a later whole-document PUT is merged against, and `savedAt`
     * is the server's now, so 3.0.0 — which adopts the server copy only when
     * it is newer than its own — always adopts what it was given.
     */
    async compatGet(): Promise<LegacyWorkspace> {
      const pages: LegacyPage[] = [];
      for (const listed of await repo.listPages()) {
        // 3.0.0 has no idea what a template is and would list it as a page.
        if (listed.template) continue;
        const page = await migrate(listed);
        const served = downgradePage(pageOf(page));
        if (!deepEqual(page.compatBase, served)) {
          await repo.setCompatBase(page.id, served);
        }
        pages.push(served);
      }
      const prefs = await repo.getPrefs();
      if (!prefs)
        throw new WorkspaceError(500, "NOT_MIGRATED", "Prefs missing");
      const input = prefsInputOf(prefs);
      await repo.setPrefsCompatBase(input);
      return {
        version: 1,
        savedAt: now().toISOString(),
        pages: Object.fromEntries(pages.map((p) => [p.id, p])),
        ...input,
      };
    },

    /**
     * `PUT /workspace` from desktop 3.0.0, merged page by page against what
     * that client was last given (or last sent): only its own edits since
     * then apply, and only where nobody else changed the same block or page
     * field meanwhile — the stored copy wins every collision
     * (`compatMergeOps`). A page whose merge cannot apply keeps what it has.
     */
    async compatPut(workspace: LegacyWorkspace): Promise<void> {
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
        const current = await migrate(stored);
        if (
          deepEqual(
            contentOf(downgradePage(pageOf(current))),
            contentOf(stored.compatBase),
          )
        ) {
          await purgeOne(current);
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
      const next: StoredPrefs = { ...prefs };
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
        await repo.savePrefs(next);
      }
      await repo.setPrefsCompatBase(incoming);
    },
  };

  async function compatPage(incoming: LegacyPage): Promise<void> {
    const existing = await repo.getPage(incoming.id);
    if (!existing) {
      const at = now();
      const page: WorkspacePage = {
        ...upgradeLegacyPage(incoming),
        updatedAt: at.toISOString(),
      };
      const inserted = await repo.insertPage({
        ...page,
        rev: 1,
        changedAt: at,
        purgedAt: null,
        legacyBlocks: null,
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
          touched: treeIds(page.blocks),
          snapshot: page,
          legacy: null,
        });
      }
      return;
    }
    if (existing.purgedAt || !existing.compatBase) return;
    const base = existing.compatBase;
    await retrying(async () => {
      const stored = await load(incoming.id);
      let result: AppliedOps;
      try {
        const ops = compatMergeOps(base, pageOf(stored), incoming, newId);
        if (ops.length === 0) return stored;
        result = applyWorkspaceOps(pageOf(stored), ops);
      } catch (error) {
        if (!(error instanceof WorkspaceOpError)) throw error;
        console.warn(
          `Desktop 3.0.0 edits to page ${incoming.id} could not apply: ${error.message}`,
        );
        return stored;
      }
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
