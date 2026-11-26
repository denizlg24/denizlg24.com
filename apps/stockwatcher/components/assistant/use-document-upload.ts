"use client";

import { useCallback, useRef, useState } from "react";
import { mutate } from "swr";
import {
  type DocumentUploadResult,
  documentLimits,
  documentUploadResultSchema,
  formatBytes,
} from "@/lib/documents/types";

export const documentsKey = "/api/documents";

export type UploadItem = {
  key: string;
  name: string;
  progress: number;
  status: "uploading" | "processing" | "error";
  error?: string;
};

function send(
  file: File,
  symbols: string,
  onProgress: (fraction: number, sent: boolean) => void,
) {
  return new Promise<DocumentUploadResult>((resolve, reject) => {
    const body = new FormData();
    body.set("file", file);
    if (symbols) body.set("symbols", symbols);
    const request = new XMLHttpRequest();
    request.open("POST", documentsKey);
    request.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(event.loaded / event.total, false);
    };
    request.upload.onload = () => onProgress(1, true);
    request.onerror = () =>
      reject(new Error("Upload failed. Check your connection."));
    request.onload = () => {
      let data: unknown;
      try {
        data = JSON.parse(request.responseText);
      } catch {
        data = null;
      }
      const message =
        typeof data === "object" && data !== null && "error" in data
          ? String(data.error)
          : "The document could not be processed.";
      const result = documentUploadResultSchema.safeParse(data);
      if (request.status >= 200 && request.status < 300 && result.success)
        resolve(result.data);
      else reject(new Error(message));
    };
    request.send(body);
  });
}

export function useDocumentUpload(
  onUploaded?: (document: DocumentUploadResult) => void,
) {
  const [items, setItems] = useState<UploadItem[]>([]);
  const counter = useRef(0);

  const patch = useCallback((key: string, change: Partial<UploadItem>) => {
    setItems((current) =>
      current.map((item) => (item.key === key ? { ...item, ...change } : item)),
    );
  }, []);

  const dismiss = useCallback(
    (key: string) =>
      setItems((current) => current.filter((item) => item.key !== key)),
    [],
  );

  const upload = useCallback(
    async (files: Iterable<File>, symbols = "") => {
      for (const file of files) {
        const key = `${Date.now()}-${counter.current++}`;
        setItems((current) => [
          ...current,
          { key, name: file.name, progress: 0, status: "uploading" },
        ]);
        if (file.size > documentLimits.uploadBytes) {
          patch(key, {
            status: "error",
            error: `Larger than ${formatBytes(documentLimits.uploadBytes)}.`,
          });
          continue;
        }
        try {
          const result = await send(file, symbols, (progress, sent) =>
            patch(key, { progress, status: sent ? "processing" : "uploading" }),
          );
          dismiss(key);
          void mutate(documentsKey);
          onUploaded?.(result);
        } catch (reason) {
          patch(key, {
            status: "error",
            error: reason instanceof Error ? reason.message : "Upload failed.",
          });
        }
      }
    },
    [dismiss, onUploaded, patch],
  );

  return { items, upload, dismiss };
}
