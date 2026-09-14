import type { QueryClient } from "@tanstack/react-query";
import { errorMessage } from "./api";
import {
  cachedFolder,
  dropSubtree,
  findRow,
  invalidateFolder,
  keys,
  removeRows,
} from "./folder-cache";

/** How long a deleted item stays recoverable before the request is sent. */
export const UNDO_WINDOW_MS = 10_000;

export interface DeletableEntry {
  id: string;
  type: "file" | "folder";
  name: string;
}

export interface DeleteFailure {
  name: string;
  message: string;
}

export interface DeleteApi {
  deleteFile(id: string, keepalive?: boolean): Promise<unknown>;
  deleteFolder(
    id: string,
    recursive: boolean,
    keepalive?: boolean,
  ): Promise<unknown>;
}

interface Batch {
  entries: DeletableEntry[];
  folderId: string;
  deleteAt: number;
  timer: ReturnType<typeof setTimeout>;
  onSettled?: (failures: DeleteFailure[]) => void;
  committing: Promise<void> | null;
}

/** Deletes are sent a few at a time; a hundred at once is a burst the Pi need not absorb. */
const COMMIT_CONCURRENCY = 4;

/**
 * Delete-with-undo, without a confirmation dialog.
 *
 * A deleted row is *marked*, not hidden: it stays in the listing dimmed with
 * a countdown, the tree and the move picker skip it, and only when the undo
 * window closes is the request sent. Hiding it instead left the folder in the
 * tree, still navigable, and a new folder with the same name answered 409
 * with no explanation — which is why `commitMatching` exists: a create that
 * collides with a deleting sibling sends that delete first.
 *
 * The pending request lives in a timer, so leaving the page before it fires
 * would discard the delete with no error anywhere. `flush` is wired to
 * pagehide and sends everything still waiting with `keepalive`.
 */
export class PendingDeletes {
  readonly #batches = new Set<Batch>();
  readonly #listeners = new Set<() => void>();
  #snapshot: ReadonlyMap<string, number> = new Map();

  constructor(
    private readonly client: QueryClient,
    private readonly api: DeleteApi,
    private readonly undoWindowMs = UNDO_WINDOW_MS,
  ) {}

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  /** id → the time its delete will be sent. A new Map per change, for `useSyncExternalStore`. */
  snapshot = (): ReadonlyMap<string, number> => this.#snapshot;

  isDeleting(id: string): boolean {
    return this.#snapshot.has(id);
  }

  deleteAt(id: string): number | null {
    return this.#snapshot.get(id) ?? null;
  }

  schedule(
    entries: DeletableEntry[],
    folderId: string,
    onSettled?: (failures: DeleteFailure[]) => void,
  ): { undo: () => void } {
    if (entries.length === 0) return { undo: () => undefined };
    const batch: Batch = {
      committing: null,
      deleteAt: Date.now() + this.undoWindowMs,
      entries,
      folderId,
      onSettled,
      timer: setTimeout(() => void this.commit(batch), this.undoWindowMs),
    };
    this.#batches.add(batch);
    this.#publish();
    return {
      undo: () => {
        if (batch.committing) return;
        clearTimeout(batch.timer);
        this.#batches.delete(batch);
        this.#publish();
      },
    };
  }

  /** Sends every delete still inside its undo window. For pagehide. */
  flush(): void {
    for (const batch of [...this.#batches]) void this.commit(batch, true);
  }

  /**
   * Commits any pending delete of a same-named sibling, so a create that
   * follows cannot 409 against a row the person already deleted.
   */
  async commitMatching(folderId: string, name: string): Promise<void> {
    const matching = [...this.#batches].filter(
      (batch) =>
        batch.folderId === folderId &&
        batch.entries.some((entry) => entry.name === name),
    );
    await Promise.all(matching.map((batch) => this.commit(batch)));
  }

  private commit(batch: Batch, keepalive = false): Promise<void> {
    if (batch.committing) return batch.committing;
    clearTimeout(batch.timer);
    batch.committing = this.#send(batch, keepalive).finally(() => {
      this.#batches.delete(batch);
      this.#publish();
    });
    return batch.committing;
  }

  async #send(batch: Batch, keepalive: boolean): Promise<void> {
    const failures: DeleteFailure[] = [];
    const deleted = new Set<string>();
    const deletedFolderPaths: string[] = [];
    const queue = [...batch.entries];
    const worker = async () => {
      for (let entry = queue.shift(); entry; entry = queue.shift()) {
        try {
          if (entry.type === "file") {
            await this.api.deleteFile(entry.id, keepalive);
          } else {
            const path = findRow(this.client, batch.folderId, entry.id)?.row
              .path;
            await this.api.deleteFolder(entry.id, true, keepalive);
            if (path) deletedFolderPaths.push(path);
          }
          deleted.add(entry.id);
        } catch (error) {
          failures.push({ message: errorMessage(error), name: entry.name });
        }
      }
    };
    await Promise.all(
      Array.from({ length: COMMIT_CONCURRENCY }, () => worker()),
    );

    removeRows(this.client, batch.folderId, deleted);
    for (const path of deletedFolderPaths) dropSubtree(this.client, path);
    const parent = cachedFolder(this.client, batch.folderId);
    void invalidateFolder(this.client, batch.folderId);
    if (parent?.parentId) {
      // A subfolder's `childCount` on the parent listing just changed.
      void this.client.invalidateQueries({
        queryKey: keys.folder(parent.parentId),
      });
    }
    void this.client.invalidateQueries({ queryKey: keys.recent });
    void this.client.invalidateQueries({ queryKey: keys.shares });
    batch.onSettled?.(failures);
  }

  #publish(): void {
    const next = new Map<string, number>();
    // A batch in flight stays marked until its rows leave the cache.
    for (const batch of this.#batches) {
      for (const entry of batch.entries) next.set(entry.id, batch.deleteAt);
    }
    this.#snapshot = next;
    for (const listener of this.#listeners) listener();
  }
}
