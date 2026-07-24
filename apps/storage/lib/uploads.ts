"use client";

import { useSyncExternalStore } from "react";
import * as tus from "tus-js-client";
import { api, errorMessage, isApiError } from "./api";
import { API_BASE_URL } from "./env";
import { normalizeFileNamePreview, normalizeNamePreview } from "./format";
import { store } from "./store";

export type UploadStatus =
  | "queued"
  | "uploading"
  | "paused"
  | "error"
  | "done"
  | "canceled";

export interface UploadItem {
  id: string;
  name: string;
  /** Sub-path inside the drop, empty for a plain file drop. */
  relativeDir: string;
  size: number;
  uploaded: number;
  status: UploadStatus;
  error: string | null;
  targetFolderId: string;
  /** Bytes/second over the life of the transfer, once it has started. */
  rate: number;
}

export interface DroppedFile {
  file: File;
  relativeDir: string;
}

const MAX_PARALLEL = 3;
const CHUNK_SIZE = 8 * 1024 * 1024;

interface Job {
  item: UploadItem;
  file: File;
  upload: tus.Upload | null;
  startedAt: number;
  /** Resolved lazily: nested folders are created just before their first file. */
  rootFolderId: string;
  rootFolderPath: string;
}

function tusErrorMessage(error: Error): string {
  const response =
    error instanceof tus.DetailedError ? error.originalResponse : null;
  if (!response) return "Connection lost";
  try {
    const parsed = JSON.parse(response.getBody()) as {
      error?: { code?: string; message?: string };
    };
    if (parsed.error?.code === "FILE_EXISTS") {
      return "A file with that name is already here";
    }
    if (parsed.error?.message) return parsed.error.message;
  } catch {
    // Fall through to the status line below.
  }
  return `Upload failed (${response.getStatus()})`;
}

class UploadQueue {
  private jobs = new Map<string, Job>();
  private order: string[] = [];
  private listeners = new Set<() => void>();
  private snapshot: UploadItem[] = [];
  /** Virtual path -> in-flight or settled resolution, shared by every job. */
  private folderIds = new Map<string, Promise<{ id: string; path: string }>>();

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): UploadItem[] => this.snapshot;

  private emit(): void {
    this.snapshot = this.order
      .map((id) => this.jobs.get(id)?.item)
      .filter((item): item is UploadItem => item !== undefined);
    for (const listener of this.listeners) listener();
  }

  private patch(id: string, patch: Partial<UploadItem>): void {
    const job = this.jobs.get(id);
    if (!job) return;
    job.item = { ...job.item, ...patch };
    this.emit();
  }

  add(
    files: DroppedFile[],
    targetFolderId: string,
    targetFolderPath: string,
  ): void {
    for (const { file, relativeDir } of files) {
      const id = crypto.randomUUID();
      this.jobs.set(id, {
        file,
        rootFolderId: targetFolderId,
        rootFolderPath: targetFolderPath,
        startedAt: 0,
        upload: null,
        item: {
          error: null,
          id,
          name: file.name,
          rate: 0,
          relativeDir,
          size: file.size,
          status: "queued",
          targetFolderId,
          uploaded: 0,
        },
      });
      this.order.push(id);
    }
    this.emit();
    this.pump();
  }

  private activeCount(): number {
    let active = 0;
    for (const job of this.jobs.values()) {
      if (job.item.status === "uploading") active += 1;
    }
    return active;
  }

  private pump(): void {
    let slots = MAX_PARALLEL - this.activeCount();
    if (slots <= 0) return;
    for (const id of this.order) {
      if (slots <= 0) return;
      const job = this.jobs.get(id);
      if (job?.item.status !== "queued") continue;
      slots -= 1;
      void this.begin(job);
    }
  }

  /** Walks the dropped sub-path, creating folders that do not exist yet. */
  private async resolveFolder(job: Job): Promise<{ id: string; path: string }> {
    let parentId = job.rootFolderId;
    let parentPath = job.rootFolderPath;
    if (!job.item.relativeDir) return { id: parentId, path: parentPath };

    for (const rawSegment of job.item.relativeDir.split("/").filter(Boolean)) {
      const name = normalizeNamePreview(rawSegment);
      if (!name) continue;
      const path = `${parentPath}/${name}`;
      const folder = await this.folderFor(parentId, path, rawSegment, name);
      parentId = folder.id;
      parentPath = folder.path;
    }
    return { id: parentId, path: parentPath };
  }

  /**
   * Every parallel job in a directory drop needs the same folders. Without a
   * shared in-flight promise they all issue the create at once and all but one
   * lose the race, so resolution is memoized per path for the whole drop.
   */
  private folderFor(
    parentId: string,
    path: string,
    rawSegment: string,
    normalizedName: string,
  ): Promise<{ id: string; path: string }> {
    const pending = this.folderIds.get(path);
    if (pending) return pending;

    const resolution = (async () => {
      try {
        const folder = await store.createFolder(parentId, rawSegment);
        return { id: folder.id, path: folder.path };
      } catch (error) {
        if (!isApiError(error) || error.code !== "FOLDER_EXISTS") throw error;
        const contents = await api.folderContents(parentId);
        const existing = contents.data.subfolders.find(
          (folder) => folder.name === normalizedName,
        );
        if (!existing) throw error;
        return { id: existing.id, path: existing.path };
      }
    })();

    this.folderIds.set(path, resolution);
    // A transient failure must not poison the path for the rest of the drop.
    resolution.catch(() => this.folderIds.delete(path));
    return resolution;
  }

  private async begin(job: Job): Promise<void> {
    this.patch(job.item.id, { status: "uploading", error: null });
    job.startedAt = Date.now();

    let target: { id: string; path: string };
    try {
      target = await this.resolveFolder(job);
    } catch (error) {
      this.patch(job.item.id, {
        status: "error",
        error: errorMessage(error),
      });
      this.pump();
      return;
    }
    if (this.jobs.get(job.item.id)?.item.status !== "uploading") return;
    this.patch(job.item.id, { targetFolderId: target.id });

    const upload = new tus.Upload(job.file, {
      chunkSize: CHUNK_SIZE,
      endpoint: new URL("/api/storage/uploads", API_BASE_URL).toString(),
      metadata: {
        filename: job.file.name,
        filetype: job.file.type || "application/octet-stream",
        targetFolder: target.path,
      },
      // The default XHR stack does not send cookies, and the session lives in
      // a cross-subdomain cookie rather than a bearer token.
      onBeforeRequest: (request) => {
        const xhr: XMLHttpRequest = request.getUnderlyingObject();
        xhr.withCredentials = true;
      },
      onError: (error) => {
        this.patch(job.item.id, {
          status: "error",
          error: tusErrorMessage(error),
        });
        this.pump();
      },
      onProgress: (uploaded, total) => {
        const elapsed = (Date.now() - job.startedAt) / 1000;
        this.patch(job.item.id, {
          rate: elapsed > 0 ? uploaded / elapsed : 0,
          size: total,
          uploaded,
        });
      },
      onSuccess: () => {
        this.patch(job.item.id, {
          status: "done",
          uploaded: job.item.size,
        });
        store.uploaded(target.id);
        this.pump();
      },
      // Retries the transport; a 4xx from the API is surfaced instead.
      retryDelays: [0, 1_000, 3_000, 6_000, 12_000],
    });
    job.upload = upload;
    upload.start();
  }

  pause(id: string): void {
    const job = this.jobs.get(id);
    if (job?.item.status !== "uploading") return;
    this.patch(id, { status: "paused" });
    void job.upload?.abort();
    this.pump();
  }

  resume(id: string): void {
    const job = this.jobs.get(id);
    if (!job) return;
    if (job.item.status !== "paused" && job.item.status !== "error") return;
    if (!job.upload) {
      this.patch(id, { status: "queued", error: null });
      this.pump();
      return;
    }
    this.patch(id, { status: "uploading", error: null });
    // Backdate the clock by however long the bytes already sent would have
    // taken, so the rate readout resumes instead of spiking. rate is bytes per
    // second and startedAt is milliseconds.
    job.startedAt =
      Date.now() - (job.item.uploaded / Math.max(1, job.item.rate)) * 1000;
    job.upload.start();
  }

  cancel(id: string): void {
    const job = this.jobs.get(id);
    if (!job) return;
    void job.upload?.abort(true).catch(() => undefined);
    this.jobs.delete(id);
    this.order = this.order.filter((entry) => entry !== id);
    this.emit();
    this.pump();
  }

  clearFinished(): void {
    for (const [id, job] of this.jobs) {
      if (job.item.status !== "done") continue;
      this.jobs.delete(id);
      this.order = this.order.filter((entry) => entry !== id);
    }
    this.emit();
  }

  retryAllFailed(): void {
    for (const [id, job] of this.jobs) {
      if (job.item.status === "error") this.resume(id);
    }
  }
}

export const uploads = new UploadQueue();

const NO_UPLOADS: UploadItem[] = [];

export function useUploads(): UploadItem[] {
  return useSyncExternalStore(
    uploads.subscribe,
    uploads.getSnapshot,
    () => NO_UPLOADS,
  );
}

export interface UploadSummary {
  active: number;
  failed: number;
  done: number;
  total: number;
  uploadedBytes: number;
  totalBytes: number;
  percent: number;
}

export function summarize(items: UploadItem[]): UploadSummary {
  let active = 0;
  let failed = 0;
  let done = 0;
  let uploadedBytes = 0;
  let totalBytes = 0;
  for (const item of items) {
    if (item.status === "uploading" || item.status === "queued") active += 1;
    if (item.status === "error") failed += 1;
    if (item.status === "done") done += 1;
    uploadedBytes += item.status === "done" ? item.size : item.uploaded;
    totalBytes += item.size;
  }
  return {
    active,
    done,
    failed,
    percent: totalBytes === 0 ? 0 : (uploadedBytes / totalBytes) * 100,
    total: items.length,
    totalBytes,
    uploadedBytes,
  };
}

/** Normalized name the API will actually store, shown before upload starts. */
export function storedName(filename: string): string {
  return normalizeFileNamePreview(filename);
}

/** Reads a drag-and-drop payload, expanding directories into relative paths. */
export async function readDataTransfer(
  dataTransfer: DataTransfer,
): Promise<DroppedFile[]> {
  const entries: FileSystemEntry[] = [];
  for (const item of Array.from(dataTransfer.items)) {
    if (item.kind !== "file") continue;
    const entry = item.webkitGetAsEntry?.();
    if (entry) entries.push(entry);
  }
  if (entries.length === 0) {
    return Array.from(dataTransfer.files).map((file) => ({
      file,
      relativeDir: "",
    }));
  }
  const results: DroppedFile[] = [];
  await Promise.all(entries.map((entry) => walkEntry(entry, "", results)));
  return results;
}

async function walkEntry(
  entry: FileSystemEntry,
  prefix: string,
  results: DroppedFile[],
): Promise<void> {
  if (entry.isFile) {
    const file = await new Promise<File | null>((resolve) => {
      (entry as FileSystemFileEntry).file(resolve, () => resolve(null));
    });
    if (file) results.push({ file, relativeDir: prefix });
    return;
  }
  if (!entry.isDirectory) return;
  const reader = (entry as FileSystemDirectoryEntry).createReader();
  const nextPrefix = prefix ? `${prefix}/${entry.name}` : entry.name;
  // readEntries returns at most 100 per call and signals the end with [].
  for (;;) {
    const batch = await new Promise<FileSystemEntry[]>((resolve) => {
      reader.readEntries(resolve, () => resolve([]));
    });
    if (batch.length === 0) return;
    await Promise.all(
      batch.map((child) => walkEntry(child, nextPrefix, results)),
    );
  }
}

/** Reads an `<input type="file" webkitdirectory>` selection. */
export function readFileList(files: FileList): DroppedFile[] {
  return Array.from(files).map((file) => {
    const relativePath = (file as File & { webkitRelativePath?: string })
      .webkitRelativePath;
    const relativeDir = relativePath
      ? relativePath.split("/").slice(0, -1).join("/")
      : "";
    return { file, relativeDir };
  });
}
