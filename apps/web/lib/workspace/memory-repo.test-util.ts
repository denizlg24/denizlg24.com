import type {
  StoredPage,
  StoredPrefs,
  StoredRevision,
  WorkspaceRepo,
} from "./repo";

/** `WorkspaceRepo` over maps, with the Mongo implementation's semantics. */
export function memoryWorkspaceRepo(legacy: unknown = null) {
  const pages = new Map<string, StoredPage>();
  const revisions: StoredRevision[] = [];
  let prefs: StoredPrefs | null = null;
  const clone = <T>(value: T): T => structuredClone(value);

  const repo: WorkspaceRepo = {
    async getPage(id) {
      const page = pages.get(id);
      return page ? clone(page) : null;
    },
    async listPages() {
      return [...pages.values()].filter((p) => !p.purgedAt).map(clone);
    },
    async pagesChangedSince(since) {
      return [...pages.values()]
        .filter((p) => p.changedAt.getTime() >= since.getTime())
        .map(clone);
    },
    async insertPage(page) {
      if (pages.has(page.id)) return false;
      pages.set(page.id, clone(page));
      return true;
    },
    async replacePage(expectedRev, page) {
      const current = pages.get(page.id);
      if (!current || current.rev !== expectedRev) return false;
      pages.set(page.id, clone(page));
      return true;
    },
    async setCompatBase(id, base) {
      const current = pages.get(id);
      if (current) current.compatBase = clone(base);
    },
    async insertRevision(revision) {
      if (
        revisions.some(
          (r) => r.pageId === revision.pageId && r.rev === revision.rev,
        )
      ) {
        return;
      }
      revisions.push(clone(revision));
    },
    async revisionsAfter(pageId, after, upTo) {
      return revisions
        .filter(
          (r) =>
            r.pageId === pageId &&
            r.rev > after &&
            (upTo === undefined || r.rev <= upTo),
        )
        .sort((a, b) => a.rev - b.rev)
        .map(clone);
    },
    async latestSnapshot(pageId, atOrBefore) {
      const found = revisions
        .filter((r) => r.pageId === pageId && r.rev <= atOrBefore && r.snapshot)
        .sort((a, b) => b.rev - a.rev)[0];
      return found ? clone(found) : null;
    },
    async listRevisions(pageId, { limit, before }) {
      return revisions
        .filter(
          (r) =>
            r.pageId === pageId && (before === undefined || r.rev < before),
        )
        .sort((a, b) => b.rev - a.rev)
        .slice(0, limit)
        .map(clone);
    },
    async deleteRevisions(pageId) {
      for (let i = revisions.length - 1; i >= 0; i--) {
        if (revisions[i]?.pageId === pageId) revisions.splice(i, 1);
      }
    },
    async getPrefs() {
      return prefs ? clone(prefs) : null;
    },
    async insertPrefs(next) {
      if (prefs) return false;
      prefs = clone(next);
      return true;
    },
    async savePrefs(next) {
      prefs = clone(next);
    },
    async loadLegacy() {
      return clone(legacy);
    },
  };

  return {
    repo,
    pages,
    revisions,
    prefs: () => prefs,
    /** The v1 document, to prove migration never writes it. */
    legacy: () => legacy,
  };
}
