"use client";

import type { DownloadArchiveInput } from "@repo/schemas/cloud";
import { api, isApiError } from "./api";
import { formatBytes } from "./format";

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
  bytes: number;
}

export class ArchiveTooLargeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ArchiveTooLargeError";
  }
}

/**
 * Streams the ZIP into memory so progress can be reported, then hands it to
 * the browser as one blob. The API's own size cap keeps this bounded.
 */
export async function downloadArchive(
  selection: DownloadArchiveInput,
  onProgress: (progress: ArchiveProgress) => void,
  signal?: AbortSignal,
): Promise<void> {
  let response: Response;
  try {
    response = await api.archive(selection, signal);
  } catch (error) {
    if (isApiError(error) && error.code === "ARCHIVE_TOO_LARGE") {
      throw new ArchiveTooLargeError(
        "That selection is too big to zip in one go — download it in smaller batches.",
      );
    }
    if (isApiError(error) && error.code === "EMPTY_ARCHIVE") {
      throw new Error("Those folders are empty, so there is nothing to zip.");
    }
    throw error;
  }

  const body = response.body;
  if (!body) throw new Error("The server sent an empty archive");

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      bytes += value.byteLength;
      onProgress({ bytes });
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  }

  const blob = new Blob(chunks as BlobPart[], { type: "application/zip" });
  const url = URL.createObjectURL(blob);
  triggerDownload(url, archiveName(response));
  // Revoking immediately can cancel the download in Safari.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

function archiveName(response: Response): string {
  const header = response.headers.get("Content-Disposition") ?? "";
  const match = header.match(/filename="([^"]+)"/);
  return match?.[1] ?? "files.zip";
}

/** Warning copy for selections large enough to strain the tab's memory. */
const MEMORY_WARNING_BYTES = 512 * 1024 * 1024;

export function archiveSizeWarning(knownBytes: number): string | null {
  if (knownBytes < MEMORY_WARNING_BYTES) return null;
  return `Zipping ${formatBytes(knownBytes)} — this may take a while and uses memory in this tab.`;
}
