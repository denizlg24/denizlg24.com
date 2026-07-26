"use client";

import type { ArchiveJob, DownloadArchiveInput } from "@repo/schemas/cloud";
import { api, isApiError } from "./api";

export function triggerDownload(url: string, filename?: string): void {
  const anchor = document.createElement("a");
  anchor.href = url;
  if (filename) anchor.download = filename;
  anchor.rel = "noopener";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
}

export interface ArchiveProgress {
  writtenBytes: number;
  totalBytes: number;
  percent: number;
}

export class ArchiveTooLargeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ArchiveTooLargeError";
  }
}

const POLL_INTERVAL_MS = 400;

function progressOf(job: ArchiveJob): ArchiveProgress {
  return {
    writtenBytes: job.writtenBytes,
    totalBytes: job.totalBytes,
    percent:
      job.totalBytes === 0
        ? 0
        : Math.min(100, (job.writtenBytes / job.totalBytes) * 100),
  };
}

function startError(error: unknown): unknown {
  if (!isApiError(error)) return error;
  if (error.code === "ARCHIVE_TOO_LARGE") {
    return new ArchiveTooLargeError(
      "That selection is too big to zip in one go — download it in smaller batches.",
    );
  }
  if (error.code === "ARCHIVE_NO_SPACE") {
    return new Error("Not enough free space on the SSD to stage that ZIP.");
  }
  if (error.code === "ARCHIVE_BUSY") {
    return new Error("Another ZIP is still building.");
  }
  if (error.code === "EMPTY_ARCHIVE") {
    return new Error("Those folders are empty, so there is nothing to zip.");
  }
  return error;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal?.reason ?? new DOMException("Aborted", "AbortError"));
    };
    if (signal?.aborted) return onAbort();
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * Asks the API to build the ZIP on disk, follows the build, then hands the
 * finished file to the browser's own downloader. Nothing is buffered in the
 * tab — a multi-gigabyte archive costs this page no memory at all.
 */
export async function downloadArchive(
  selection: DownloadArchiveInput,
  onProgress: (progress: ArchiveProgress) => void,
  signal?: AbortSignal,
): Promise<void> {
  let job: ArchiveJob;
  try {
    job = await api.archive(selection, signal);
  } catch (error) {
    throw startError(error);
  }
  onProgress(progressOf(job));

  while (job.state === "building") {
    await sleep(POLL_INTERVAL_MS, signal);
    job = await api.archiveStatus(job.id, signal);
    onProgress(progressOf(job));
  }
  if (job.state === "failed") {
    throw new Error(job.error ?? "The archive could not be built");
  }
  triggerDownload(api.url.archiveDownload(job.id), job.filename);
}
