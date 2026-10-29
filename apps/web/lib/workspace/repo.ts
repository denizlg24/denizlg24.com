import type {
  WorkspaceAppliedOp,
  WorkspacePage,
  WorkspacePrefs,
  WorkspacePrefsInput,
  WorkspaceRevisionKind,
} from "@repo/schemas";

export interface StoredPage extends WorkspacePage {
  rev: number;
  /** Server time of the last write; the change feed reads it. */
  changedAt: Date;
  purgedAt: Date | null;
  compatBase: WorkspacePage | null;
}

export interface StoredRevision {
  pageId: string;
  rev: number;
  actor: string;
  via: string | null;
  kind: WorkspaceRevisionKind;
  at: Date;
  ops: WorkspaceAppliedOp[];
  inverse: WorkspaceAppliedOp[];
  touched: string[];
  snapshot: WorkspacePage | null;
}

export interface StoredPrefs extends WorkspacePrefs {
  changedAt: Date;
  compatBase: WorkspacePrefsInput | null;
  migratedAt: Date;
  migratedFrom: string | null;
}

/**
 * Persistence the workspace service runs on. The Mongo implementation is
 * `mongo-repo.ts`; tests use an in-memory one with the same semantics.
 */
export interface WorkspaceRepo {
  /** Purged tombstones included. */
  getPage(id: string): Promise<StoredPage | null>;
  /** Purged tombstones excluded. */
  listPages(): Promise<StoredPage[]>;
  /** Purged tombstones included. */
  pagesChangedSince(since: Date): Promise<StoredPage[]>;
  /** False when a page with this id already exists. */
  insertPage(page: StoredPage): Promise<boolean>;
  /**
   * Compare-and-set on the stored rev; false when it moved on. Leaves
   * `compatBase` as stored: `setCompatBase` moves it without a rev, so a
   * write that read the page earlier would otherwise put back an old one.
   */
  replacePage(expectedRev: number, page: StoredPage): Promise<boolean>;
  setCompatBase(id: string, base: WorkspacePage | null): Promise<void>;
  /** Idempotent on (pageId, rev). */
  insertRevision(revision: StoredRevision): Promise<void>;
  /** Ascending, rev in (after, upTo]. */
  revisionsAfter(
    pageId: string,
    after: number,
    upTo?: number,
  ): Promise<StoredRevision[]>;
  latestSnapshot(
    pageId: string,
    atOrBefore: number,
  ): Promise<StoredRevision | null>;
  /** Descending, rev < `before` when given. */
  listRevisions(
    pageId: string,
    options: { limit: number; before?: number },
  ): Promise<StoredRevision[]>;
  deleteRevisions(pageId: string): Promise<void>;
  getPrefs(): Promise<StoredPrefs | null>;
  /** False when the singleton already exists. */
  insertPrefs(prefs: StoredPrefs): Promise<boolean>;
  /** Leaves `compatBase` as stored, for the reason `replacePage` does. */
  savePrefs(prefs: StoredPrefs): Promise<void>;
  setPrefsCompatBase(base: WorkspacePrefsInput | null): Promise<void>;
  /** The v1 `DesktopWorkspace` document's data, unparsed. */
  loadLegacy(): Promise<unknown>;
}
