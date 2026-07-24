"use client";

import type {
  FolderContents,
  FolderCrumb,
  Pagination,
  RootFolders,
  StorageFile,
  StorageFolder,
} from "@repo/schemas/cloud";
import { useEffect, useSyncExternalStore } from "react";
import { api, errorMessage } from "./api";

export interface FolderState {
  folder: FolderContents["folder"] | null;
  ancestors: FolderCrumb[];
  subfolders: StorageFolder[];
  files: StorageFile[];
  pagination: Pagination | null;
  loading: boolean;
  loadingMore: boolean;
  error: string | null;
}

const EMPTY: FolderState = {
  folder: null,
  ancestors: [],
  subfolders: [],
  files: [],
  pagination: null,
  loading: true,
  loadingMore: false,
  error: null,
};

export interface SelectedEntry {
  id: string;
  type: "file" | "folder";
  name: string;
}

/** How long a deleted item stays recoverable before the request is sent. */
export const UNDO_WINDOW_MS = 7_000;

const PAGE_SIZE = 100;

class StorageStore {
  private raw = new Map<string, FolderState>();
  private views = new Map<string, FolderState>();
  private inflight = new Map<string, Promise<void>>();
  private pagesLoaded = new Map<string, number>();
  /** Optimistically removed ids whose DELETE has not been sent yet. */
  private hidden = new Set<string>();
  private listeners = new Set<() => void>();
  private rootsValue: RootFolders | null = null;
  private rootsPromise: Promise<RootFolders> | null = null;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private emit(): void {
    for (const listener of this.listeners) listener();
  }

  private touch(...ids: string[]): void {
    for (const id of ids) this.views.delete(id);
    this.emit();
  }

  get = (id: string): FolderState => {
    const cached = this.views.get(id);
    if (cached) return cached;
    const entry = this.raw.get(id);
    const view: FolderState = entry
      ? {
          ...entry,
          subfolders: entry.subfolders.filter(
            (folder) => !this.hidden.has(folder.id),
          ),
          files: entry.files.filter((file) => !this.hidden.has(file.id)),
        }
      : EMPTY;
    this.views.set(id, view);
    return view;
  };

  private set(id: string, patch: Partial<FolderState>): void {
    this.raw.set(id, { ...(this.raw.get(id) ?? EMPTY), ...patch });
    this.touch(id);
  }

  async roots(): Promise<RootFolders> {
    if (this.rootsValue) return this.rootsValue;
    this.rootsPromise ??= api.roots().then((value) => {
      this.rootsValue = value;
      this.rootsPromise = null;
      this.emit();
      return value;
    });
    try {
      return await this.rootsPromise;
    } catch (error) {
      this.rootsPromise = null;
      throw error;
    }
  }

  cachedRoots(): RootFolders | null {
    return this.rootsValue;
  }

  /** Fetches pages 1..`pages` and replaces the entry with the result. */
  private async load(id: string, pages: number, quiet: boolean): Promise<void> {
    if (!quiet) this.set(id, { loading: true, error: null });
    try {
      const first = await api.folderContents(id, {
        page: 1,
        limit: PAGE_SIZE,
      });
      const files = [...first.data.files];
      for (let page = 2; page <= pages; page += 1) {
        if (page > first.pagination.totalPages) break;
        const next = await api.folderContents(id, { page, limit: PAGE_SIZE });
        files.push(...next.data.files);
      }
      this.pagesLoaded.set(
        id,
        Math.max(1, Math.min(pages, first.pagination.totalPages)),
      );
      this.set(id, {
        folder: first.data.folder,
        ancestors: first.data.ancestors,
        subfolders: first.data.subfolders,
        files,
        pagination: first.pagination,
        loading: false,
        loadingMore: false,
        error: null,
      });
    } catch (error) {
      this.set(id, {
        loading: false,
        loadingMore: false,
        error: errorMessage(error),
      });
    }
  }

  private run(id: string, pages: number, quiet: boolean): Promise<void> {
    const existing = this.inflight.get(id);
    if (existing) return existing;
    const promise = this.load(id, pages, quiet).finally(() => {
      this.inflight.delete(id);
    });
    this.inflight.set(id, promise);
    return promise;
  }

  ensure(id: string): Promise<void> {
    if (this.raw.has(id)) return Promise.resolve();
    return this.run(id, 1, false);
  }

  reload(id: string, quiet = false): Promise<void> {
    return this.run(id, this.pagesLoaded.get(id) ?? 1, quiet);
  }

  /** Re-fetches only folders already in the cache; unseen ones stay cold. */
  invalidate(...ids: (string | null | undefined)[]): void {
    for (const id of ids) {
      if (!id || !this.raw.has(id)) continue;
      void this.reload(id, true);
    }
  }

  async loadMore(id: string): Promise<void> {
    const entry = this.raw.get(id);
    if (!entry?.pagination || entry.loadingMore) return;
    const nextPage = entry.pagination.page + 1;
    if (nextPage > entry.pagination.totalPages) return;
    this.set(id, { loadingMore: true });
    try {
      const next = await api.folderContents(id, {
        page: nextPage,
        limit: PAGE_SIZE,
      });
      const current = this.raw.get(id);
      if (!current) return;
      const known = new Set(current.files.map((file) => file.id));
      this.pagesLoaded.set(id, nextPage);
      this.set(id, {
        files: [
          ...current.files,
          ...next.data.files.filter((file) => !known.has(file.id)),
        ],
        pagination: next.pagination,
        loadingMore: false,
      });
    } catch (error) {
      this.set(id, { loadingMore: false, error: errorMessage(error) });
    }
  }

  async createFolder(parentId: string, name: string): Promise<StorageFolder> {
    const created = await api.createFolder({ name, parentId });
    // The create response omits createdAt; the row was just written, so now is
    // accurate enough for the "last modified" column until the next refetch.
    const folder: StorageFolder = {
      id: created.id,
      name: created.name,
      path: created.path,
      parentId: created.parentId,
      createdAt: new Date().toISOString(),
    };
    const entry = this.raw.get(parentId);
    if (entry) {
      this.set(parentId, {
        subfolders: [...entry.subfolders, folder].sort((a, b) =>
          a.name.localeCompare(b.name),
        ),
      });
    }
    return folder;
  }

  async renameFolder(
    id: string,
    parentId: string,
    name: string,
  ): Promise<void> {
    const parent = this.raw.get(parentId);
    const previous = parent?.subfolders;
    if (parent && previous) {
      this.set(parentId, {
        subfolders: previous
          .map((folder) => (folder.id === id ? { ...folder, name } : folder))
          .sort((a, b) => a.name.localeCompare(b.name)),
      });
    }
    try {
      const updated = await api.updateFolder(id, { name });
      if (this.raw.get(parentId)) {
        this.set(parentId, {
          subfolders: (this.raw.get(parentId)?.subfolders ?? [])
            .map((folder) =>
              folder.id === id
                ? { ...folder, name: updated.name, path: updated.path }
                : folder,
            )
            .sort((a, b) => a.name.localeCompare(b.name)),
        });
      }
      // Descendants' paths changed server-side; anything cached below is stale.
      this.dropSubtree(id);
    } catch (error) {
      if (previous) this.set(parentId, { subfolders: previous });
      throw error;
    }
  }

  async renameFile(
    id: string,
    folderId: string,
    filename: string,
  ): Promise<void> {
    const entry = this.raw.get(folderId);
    const previous = entry?.files;
    if (previous) {
      this.set(folderId, {
        files: previous.map((file) =>
          file.id === id ? { ...file, filename } : file,
        ),
      });
    }
    try {
      const updated = await api.updateFile(id, { filename });
      if (this.raw.get(folderId)) {
        this.set(folderId, {
          files: (this.raw.get(folderId)?.files ?? []).map((file) =>
            file.id === id
              ? { ...file, filename: updated.filename, path: updated.path }
              : file,
          ),
        });
      }
    } catch (error) {
      if (previous) this.set(folderId, { files: previous });
      throw error;
    }
  }

  /** Moves a mixed selection; returns how many landed successfully. */
  async move(
    entries: SelectedEntry[],
    sourceFolderId: string,
    targetFolderId: string,
  ): Promise<{ moved: number; failures: { name: string; message: string }[] }> {
    const movingIds = new Set(entries.map((entry) => entry.id));
    for (const id of movingIds) this.hidden.add(id);
    this.touch(sourceFolderId);

    const failures: { name: string; message: string }[] = [];
    let moved = 0;
    for (const entry of entries) {
      try {
        if (entry.type === "file") {
          await api.updateFile(entry.id, { folderId: targetFolderId });
        } else {
          await api.updateFolder(entry.id, { parentId: targetFolderId });
          this.dropSubtree(entry.id);
        }
        moved += 1;
      } catch (error) {
        failures.push({ name: entry.name, message: errorMessage(error) });
        this.hidden.delete(entry.id);
      }
    }
    // Drop the moved rows for real, then let both ends re-read from the server.
    for (const id of movingIds) this.hidden.delete(id);
    this.invalidate(sourceFolderId, targetFolderId);
    this.touch(sourceFolderId, targetFolderId);
    return { moved, failures };
  }

  /**
   * Hides the entries immediately and only sends the DELETE once the undo
   * window closes, so "delete" needs no confirmation dialog and stays
   * reversible. A reload during the window simply brings the items back.
   */
  scheduleDelete(
    entries: SelectedEntry[],
    folderId: string,
    onSettled?: (failures: { name: string; message: string }[]) => void,
  ): { undo: () => void } {
    for (const entry of entries) this.hidden.add(entry.id);
    this.touch(folderId);

    const timer = setTimeout(() => {
      void this.commitDelete(entries, folderId, onSettled);
    }, UNDO_WINDOW_MS);

    return {
      undo: () => {
        clearTimeout(timer);
        for (const entry of entries) this.hidden.delete(entry.id);
        this.touch(folderId);
      },
    };
  }

  private async commitDelete(
    entries: SelectedEntry[],
    folderId: string,
    onSettled?: (failures: { name: string; message: string }[]) => void,
  ): Promise<void> {
    const failures: { name: string; message: string }[] = [];
    const deleted = new Set<string>();
    for (const entry of entries) {
      try {
        if (entry.type === "file") {
          await api.deleteFile(entry.id);
        } else {
          await api.deleteFolder(entry.id, true);
          this.dropSubtree(entry.id);
        }
        deleted.add(entry.id);
      } catch (error) {
        failures.push({ name: entry.name, message: errorMessage(error) });
      }
      this.hidden.delete(entry.id);
    }
    const entry = this.raw.get(folderId);
    if (entry) {
      this.set(folderId, {
        files: entry.files.filter((file) => !deleted.has(file.id)),
        subfolders: entry.subfolders.filter(
          (folder) => !deleted.has(folder.id),
        ),
      });
    }
    this.touch(folderId);
    onSettled?.(failures);
  }

  /** Forgets a folder and everything cached beneath it. */
  private dropSubtree(id: string): void {
    const entry = this.raw.get(id);
    this.raw.delete(id);
    this.views.delete(id);
    this.pagesLoaded.delete(id);
    for (const child of entry?.subfolders ?? []) this.dropSubtree(child.id);
    this.emit();
  }

  /** Called by the upload queue when a file lands in a folder. */
  uploaded(folderId: string): void {
    this.invalidate(folderId);
  }
}

export const store = new StorageStore();

export function useFolder(id: string | null): FolderState {
  const state = useSyncExternalStore(
    store.subscribe,
    () => (id ? store.get(id) : EMPTY),
    () => EMPTY,
  );
  useEffect(() => {
    if (id) void store.ensure(id);
  }, [id]);
  return state;
}

export function useRoots(): RootFolders | null {
  const roots = useSyncExternalStore(
    store.subscribe,
    () => store.cachedRoots(),
    () => null,
  );
  useEffect(() => {
    void store.roots().catch(() => undefined);
  }, []);
  return roots;
}

export function userRootId(roots: RootFolders | null): string | null {
  if (!roots) return null;
  return "projectRoot" in roots ? roots.projectRoot.id : roots.userRoot.id;
}
