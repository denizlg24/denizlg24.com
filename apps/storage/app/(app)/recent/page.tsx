"use client";

import type { RecentFile } from "@repo/schemas/cloud";
import { Button } from "@repo/ui/button";
import { Skeleton } from "@repo/ui/skeleton";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { FileTile } from "@/components/file-tiles";
import { EmptyFolderIllustration } from "@/components/illustrations";
import { Lightbox } from "@/components/lightbox";
import { api, errorMessage } from "@/lib/api";
import { keys } from "@/lib/folder-cache";

const DAY_MS = 24 * 60 * 60 * 1_000;

function dayLabel(iso: string, now: Date): string {
  const date = new Date(iso);
  const startOfToday = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
  );
  const diffDays = Math.floor(
    (startOfToday.getTime() -
      new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()) /
      DAY_MS,
  );
  if (diffDays <= 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return "This week";
  return date.toLocaleDateString(undefined, {
    day: "numeric",
    month: "long",
    year: date.getFullYear() === now.getFullYear() ? undefined : "numeric",
  });
}

function newestOf(file: RecentFile): string {
  return file.updatedAt > file.createdAt ? file.updatedAt : file.createdAt;
}

export default function RecentPage() {
  const router = useRouter();
  const recent = useQuery({
    queryKey: keys.recent,
    queryFn: () => api.recent(100),
    staleTime: 30_000,
    refetchInterval: 30_000,
  });
  const [previewId, setPreviewId] = useState<string | null>(null);
  const files = recent.data ?? [];
  const groups = useMemo(() => {
    const now = new Date();
    const map = new Map<string, RecentFile[]>();
    for (const file of files) {
      const label = dayLabel(newestOf(file), now);
      map.set(label, [...(map.get(label) ?? []), file]);
    }
    return [...map.entries()];
  }, [files]);
  const previewFile = files.find((file) => file.id === previewId) ?? null;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="border-b px-4 pb-3 pt-3 md:px-6">
        <h1 className="text-xl font-semibold tracking-tight md:text-2xl">
          Recent
        </h1>
        <p className="text-sm text-muted-foreground">
          The latest files added or changed in My files and Family.
        </p>
      </div>
      <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto">
        {recent.isPending && (
          <ul className="grid grid-cols-[repeat(auto-fill,minmax(168px,1fr))] gap-2 p-3">
            {Array.from({ length: 8 }, (_, index) => (
              <li key={index} className="flex flex-col gap-2 p-2">
                <Skeleton className="aspect-[4/3] w-full rounded-lg" />
                <Skeleton className="h-3.5 w-2/3" />
                <Skeleton className="h-3 w-1/3" />
              </li>
            ))}
          </ul>
        )}
        {recent.error && (
          <div className="flex flex-col items-center gap-3 px-4 py-20 text-center">
            <p className="text-base font-medium">Couldn't load recent files</p>
            <p className="text-sm text-muted-foreground">
              {errorMessage(recent.error)}
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => recent.refetch()}
            >
              Try again
            </Button>
          </div>
        )}
        {recent.data && files.length === 0 && (
          <div className="flex flex-col items-center gap-3 px-4 py-20 text-center">
            <EmptyFolderIllustration className="text-muted-foreground/70" />
            <p className="text-base font-medium">Nothing here yet</p>
            <p className="max-w-sm text-sm text-muted-foreground">
              Files you or the family add will show up here, newest first.
            </p>
          </div>
        )}
        {groups.map(([label, items]) => (
          <section key={label} className="px-3 pb-2 pt-4">
            <h2 className="px-2 pb-2 text-sm font-medium text-muted-foreground">
              {label}
            </h2>
            <ul className="grid grid-cols-[repeat(auto-fill,minmax(168px,1fr))] gap-2">
              {items.map((file) => (
                <FileTile
                  key={file.id}
                  file={{
                    id: file.id,
                    mimeType: file.mimeType,
                    name: file.filename,
                    sizeBytes: file.sizeBytes,
                    thumbnail: file.thumbnail,
                    updatedAt: file.updatedAt,
                  }}
                  meta={`in ${file.folder.name}`}
                  tabIndex={0}
                  onClick={() => setPreviewId(file.id)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") setPreviewId(file.id);
                  }}
                />
              ))}
            </ul>
          </section>
        ))}
      </div>
      {previewFile && (
        <Lightbox
          files={files}
          fileId={previewFile.id}
          folderId={previewFile.folder.id}
          folder={null}
          ancestors={[]}
          onSelect={setPreviewId}
          onClose={() => setPreviewId(null)}
          onMove={(file, targetFolderId) => {
            router.push(`/folders/${targetFolderId}`);
            void file;
          }}
        />
      )}
    </div>
  );
}
