"use client";

import { formatBytes } from "@repo/cloud-ui/format";
import type { SharedFileMeta } from "@repo/schemas/cloud";
import { Button } from "@repo/ui/button";
import { Download } from "lucide-react";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { FilePreview } from "@/components/file-preview";
import { api, isApiError } from "@/lib/api";

/**
 * Public landing page for a share link. Deliberately carries no session, no
 * app shell and no navigation — it only ever shows the one shared file.
 */
export default function SharedFilePage() {
  const params = useParams<{ token: string }>();
  const token = params?.token ?? "";
  const [meta, setMeta] = useState<SharedFileMeta | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    let active = true;
    api
      .sharedMeta(token)
      .then((value) => {
        if (active) setMeta(value);
      })
      .catch((err: unknown) => {
        if (!active) return;
        setError(
          isApiError(err) && err.status === 403
            ? "This link has expired or is no longer valid."
            : isApiError(err) && err.status === 404
              ? "This file is no longer available."
              : "Couldn't open this link.",
        );
      });
    return () => {
      active = false;
    };
  }, [token]);

  useEffect(() => {
    document.title = meta ? `${meta.filename} — deniz cloud` : "Shared file";
  }, [meta]);

  if (error) {
    return (
      <main className="flex min-h-dvh flex-col items-center justify-center gap-2 px-4 text-center">
        <p className="text-sm font-medium">{error}</p>
        <p className="text-sm text-muted-foreground">
          Ask whoever sent it for a fresh link.
        </p>
      </main>
    );
  }

  if (!meta) {
    return (
      <main className="flex min-h-dvh items-center justify-center">
        <span className="size-1.5 animate-pulse rounded-full bg-muted-foreground" />
      </main>
    );
  }

  return (
    <main className="flex min-h-dvh flex-col">
      <header className="flex h-12 shrink-0 items-center gap-3 border-b px-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium" title={meta.filename}>
            {meta.filename}
          </p>
          <p className="text-xs text-muted-foreground">
            {formatBytes(meta.sizeBytes)} · shared with you
          </p>
        </div>
        <Button size="sm" className="h-8" asChild>
          <a
            href={api.url.sharedDownload(token)}
            download={meta.filename}
            rel="noopener"
          >
            <Download className="size-3.5" />
            Download
          </a>
        </Button>
      </header>
      <div className="flex min-h-0 flex-1 flex-col">
        <FilePreview
          url={api.url.shared(token)}
          downloadUrl={api.url.sharedDownload(token)}
          filename={meta.filename}
          mimeType={meta.mimeType}
          sizeBytes={meta.sizeBytes}
        />
      </div>
    </main>
  );
}
