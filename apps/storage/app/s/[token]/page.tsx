"use client";

import { formatBytes, formatRelative, pluralize } from "@repo/cloud-ui/format";
import type {
  SharedContents,
  SharedFile,
  SharedMeta,
} from "@repo/schemas/cloud";
import { Button } from "@repo/ui/button";
import { Input } from "@repo/ui/input";
import { Progress } from "@repo/ui/progress";
import { Skeleton } from "@repo/ui/skeleton";
import {
  useInfiniteQuery,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { ChevronRight, Download, Lock } from "lucide-react";
import {
  useParams,
  usePathname,
  useRouter,
  useSearchParams,
} from "next/navigation";
import { Suspense, useEffect, useId, useRef, useState } from "react";
import { FilePreview } from "@/components/file-preview";
import { FileTile, FolderTile } from "@/components/file-tiles";
import { EmptyFolderIllustration } from "@/components/illustrations";
import { LightboxButton, LightboxFrame } from "@/components/lightbox-frame";
import { api, errorMessage, isApiError } from "@/lib/api";
import {
  type ArchiveProgress,
  ArchiveTooLargeError,
  downloadSharedArchive,
} from "@/lib/download";

const PAGE_SIZE = 100;

function metaKey(token: string) {
  return ["shared", token, "meta"] as const;
}

/**
 * The page a share link opens. No session, no shell: whoever holds the link
 * sees the one file or folder and nothing around it. A password share asks
 * for the password before it shows anything but who sent it and what.
 */
export default function SharedPage() {
  return (
    <Suspense fallback={null}>
      <SharedView />
    </Suspense>
  );
}

function SharedView() {
  const params = useParams<{ token: string }>();
  const token = params?.token ?? "";
  const meta = useQuery({
    queryKey: metaKey(token),
    queryFn: () => api.shared.meta(token),
    enabled: token !== "",
    retry: false,
    staleTime: 60_000,
  });

  useEffect(() => {
    document.title = meta.data
      ? `${meta.data.name} — Deniz Cloud`
      : "Shared with you — Deniz Cloud";
  }, [meta.data]);

  if (meta.isPending) {
    return (
      <main className="flex min-h-dvh flex-col">
        <div className="mx-auto w-full max-w-5xl px-4 py-6">
          <Skeleton className="h-5 w-64" />
          <Skeleton className="mt-2 h-4 w-40" />
        </div>
      </main>
    );
  }
  if (meta.isError) {
    return <Unavailable error={meta.error} />;
  }
  if (meta.data.requiresPassword && !meta.data.unlocked) {
    return (
      <PasswordGate
        token={token}
        meta={meta.data}
        onUnlocked={() => void meta.refetch()}
      />
    );
  }
  return meta.data.kind === "file" ? (
    <SharedFileView token={token} meta={meta.data} />
  ) : (
    <SharedFolderView token={token} meta={meta.data} />
  );
}

function Unavailable({ error }: { error: unknown }) {
  const unreachable = isApiError(error) && error.status === 0;
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-2 px-4 text-center">
      <p className="text-base font-medium">
        {unreachable
          ? "Deniz Cloud can't be reached right now"
          : "This link no longer works"}
      </p>
      <p className="max-w-sm text-sm text-muted-foreground">
        {unreachable
          ? "Try again in a few minutes."
          : "It may have expired or been stopped by the person who shared it. Ask them for a new one."}
      </p>
    </main>
  );
}

function SharedHeader({
  meta,
  children,
}: {
  meta: SharedMeta;
  children?: React.ReactNode;
}) {
  const details: string[] = [];
  if (meta.kind === "folder" && meta.itemCount !== undefined) {
    details.push(
      meta.itemCount === 0 ? "Empty" : pluralize(meta.itemCount, "item"),
    );
    if (meta.totalBytes) details.push(formatBytes(meta.totalBytes));
  }
  if (meta.kind === "file" && meta.sizeBytes !== undefined) {
    details.push(formatBytes(meta.sizeBytes));
  }
  if (meta.expiresAt) details.push(`expires ${formatRelative(meta.expiresAt)}`);
  return (
    <header className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-b px-4 py-3 md:px-6">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm">
          <span className="font-semibold">{meta.sharer.username}</span> shared{" "}
          <span className="font-medium" title={meta.name}>
            {meta.name}
          </span>{" "}
          with you
        </p>
        {details.length > 0 && (
          <p className="truncate text-xs text-muted-foreground">
            {details.join(" · ")}
          </p>
        )}
      </div>
      {children}
    </header>
  );
}

function PasswordGate({
  token,
  meta,
  onUnlocked,
}: {
  token: string;
  meta: SharedMeta;
  onUnlocked: () => void;
}) {
  const id = useId();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!password || busy) return;
    setBusy(true);
    setError(null);
    try {
      await api.shared.unlock(token, password);
      onUnlocked();
    } catch (err) {
      if (isApiError(err) && err.status === 429) {
        setError("Too many tries. Wait a minute and try again.");
      } else if (isApiError(err) && err.code === "SHARE_PASSWORD_WRONG") {
        setError("That password isn't right.");
      } else {
        setError(errorMessage(err));
      }
      setBusy(false);
    }
  };

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-4">
      <form
        onSubmit={(event) => void submit(event)}
        className="flex w-full max-w-sm flex-col gap-4"
      >
        <div className="flex flex-col items-center gap-2 text-center">
          <Lock className="size-8 text-muted-foreground" strokeWidth={1.5} />
          <p className="text-base">
            <span className="font-semibold">{meta.sharer.username}</span> shared{" "}
            <span className="font-medium">{meta.name}</span> with you
          </p>
          <p className="text-sm text-muted-foreground">
            This link has a password. {meta.sharer.username} should have sent it
            to you separately.
          </p>
        </div>
        <label htmlFor={id} className="sr-only">
          Password
        </label>
        <Input
          id={id}
          type="password"
          autoComplete="off"
          autoFocus
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          placeholder="Password"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error` : undefined}
          disabled={busy}
        />
        {error && (
          <p
            id={`${id}-error`}
            className="text-sm text-destructive"
            role="alert"
          >
            {error}
          </p>
        )}
        <Button type="submit" disabled={busy || password === ""}>
          {busy ? "Opening…" : "Open"}
        </Button>
      </form>
    </main>
  );
}

function SharedFileView({ token, meta }: { token: string; meta: SharedMeta }) {
  const downloadUrl = meta.allowDownload ? api.url.sharedDownload(token) : null;
  return (
    <main className="flex h-dvh flex-col">
      <SharedHeader meta={meta}>
        {downloadUrl && (
          <Button size="sm" className="h-8" asChild>
            <a href={downloadUrl} download={meta.name} rel="noopener">
              <Download className="size-3.5" />
              Download
            </a>
          </Button>
        )}
      </SharedHeader>
      <div className="flex min-h-0 flex-1 flex-col">
        <FilePreview
          url={api.url.shared(token)}
          downloadUrl={downloadUrl}
          filename={meta.name}
          mimeType={meta.mimeType ?? null}
          sizeBytes={meta.sizeBytes ?? 0}
          poster={
            meta.thumbnail && meta.updatedAt
              ? api.url.sharedThumbnail(token, 1024, meta.updatedAt)
              : null
          }
        />
      </div>
    </main>
  );
}

function sharedThumbnail(
  token: string,
  file: SharedFile,
  width: 256 | 512 | 1024,
): string | null {
  return file.thumbnail
    ? api.url.sharedFileThumbnail(token, file.id, width, file.updatedAt)
    : null;
}

function SharedFolderView({
  token,
  meta,
}: {
  token: string;
  meta: SharedMeta;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const client = useQueryClient();
  const root = meta.folderId ?? "";
  const folderId = search.get("folder") ?? root;
  const previewId = search.get("preview");

  const navigate = (next: { folder?: string; preview?: string | null }) => {
    const query = new URLSearchParams();
    const folder = next.folder ?? folderId;
    if (folder !== root) query.set("folder", folder);
    if (next.preview) query.set("preview", next.preview);
    const suffix = query.toString();
    router.push(suffix ? `${pathname}?${suffix}` : pathname, { scroll: false });
  };

  const contents = useInfiniteQuery({
    queryKey: ["shared", token, "contents", folderId],
    queryFn: ({ pageParam, signal }) =>
      api.shared.contents(
        token,
        { folderId, limit: PAGE_SIZE, page: pageParam },
        { signal },
      ),
    initialPageParam: 1,
    getNextPageParam: (last) =>
      last.pagination.page < last.pagination.totalPages
        ? last.pagination.page + 1
        : undefined,
    retry: false,
    staleTime: 30_000,
  });

  // The unlock cookie can lapse while the page is open. Re-reading the meta
  // brings the password gate back instead of leaving an error on the grid.
  const locked =
    isApiError(contents.error) && contents.error.code === "SHARE_LOCKED";
  useEffect(() => {
    if (locked) void client.invalidateQueries({ queryKey: metaKey(token) });
  }, [locked, client, token]);

  const first = contents.data?.pages[0]?.data;
  const files = contents.data?.pages.flatMap((page) => page.data.files) ?? [];
  const subfolders = first?.subfolders ?? [];

  return (
    <main className="flex min-h-dvh flex-col">
      <SharedHeader meta={meta}>
        {meta.allowDownload && meta.itemCount !== 0 && (
          <DownloadAll token={token} totalBytes={meta.totalBytes ?? 0} />
        )}
      </SharedHeader>

      {first && (
        <Crumbs
          root={{ id: root, name: meta.name }}
          contents={first}
          onOpen={(id) => navigate({ folder: id, preview: null })}
        />
      )}

      {contents.isPending ? (
        <ul className="grid grid-cols-[repeat(auto-fill,minmax(168px,1fr))] gap-2 p-3">
          {Array.from({ length: 8 }, (_, index) => (
            <li key={index} className="flex flex-col gap-2 p-2">
              <Skeleton className="aspect-[4/3] w-full rounded-lg" />
              <Skeleton className="h-3.5 w-2/3" />
              <Skeleton className="h-3 w-1/3" />
            </li>
          ))}
        </ul>
      ) : contents.isError ? (
        <div className="flex flex-col items-start gap-3 px-4 py-10 md:px-6">
          <p className="text-sm text-destructive" role="alert">
            {isApiError(contents.error) && contents.error.status === 404
              ? "That folder isn't part of this link."
              : `Couldn't open this folder: ${errorMessage(contents.error)}`}
          </p>
          <Button
            variant="outline"
            onClick={() => navigate({ folder: root, preview: null })}
          >
            Back to {meta.name}
          </Button>
        </div>
      ) : subfolders.length === 0 && files.length === 0 ? (
        <div className="flex flex-col items-center gap-3 px-4 py-20 text-center">
          <EmptyFolderIllustration className="text-muted-foreground/70" />
          <p className="text-base font-medium">Nothing here yet</p>
        </div>
      ) : (
        <>
          <ul
            className="grid grid-cols-[repeat(auto-fill,minmax(168px,1fr))] gap-2 p-3"
            aria-label="Shared files"
          >
            {subfolders.map((folder) => {
              const open = () => navigate({ folder: folder.id, preview: null });
              const count = folder.childCount.files + folder.childCount.folders;
              return (
                <FolderTile
                  key={folder.id}
                  name={folder.name}
                  meta={count === 0 ? "Empty" : pluralize(count, "item")}
                  onClick={open}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") open();
                  }}
                  tabIndex={0}
                />
              );
            })}
            {files.map((file) => {
              const open = () => navigate({ preview: file.id });
              return (
                <FileTile
                  key={file.id}
                  file={{
                    id: file.id,
                    mimeType: file.mimeType,
                    name: file.filename,
                    sizeBytes: file.sizeBytes,
                    thumbnail: file.thumbnail,
                    thumbnailSrc: sharedThumbnail(token, file, 256),
                    updatedAt: file.updatedAt,
                  }}
                  onClick={open}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") open();
                  }}
                  tabIndex={0}
                />
              );
            })}
          </ul>
          {contents.hasNextPage && (
            <div className="flex justify-center p-3">
              <Button
                variant="outline"
                disabled={contents.isFetchingNextPage}
                onClick={() => void contents.fetchNextPage()}
              >
                {contents.isFetchingNextPage ? "Loading…" : "Show more"}
              </Button>
            </div>
          )}
        </>
      )}

      {previewId && files.length > 0 && (
        <LightboxFrame
          items={files}
          itemId={previewId}
          onSelect={(id) => navigate({ preview: id })}
          onClose={() => navigate({ preview: null })}
          thumbnail={(file, width) => sharedThumbnail(token, file, width)}
          actions={
            meta.allowDownload && (
              <LightboxButton label="Download" asChild>
                <a href={api.url.sharedFileDownload(token, previewId)} download>
                  <Download className="size-4" />
                </a>
              </LightboxButton>
            )
          }
        >
          {(file) => (
            <FilePreview
              key={file.id}
              url={api.url.sharedFile(token, file.id)}
              downloadUrl={
                meta.allowDownload
                  ? api.url.sharedFileDownload(token, file.id)
                  : null
              }
              filename={file.filename}
              mimeType={file.mimeType}
              sizeBytes={file.sizeBytes}
              poster={sharedThumbnail(token, file, 1024)}
            />
          )}
        </LightboxFrame>
      )}
    </main>
  );
}

function Crumbs({
  root,
  contents,
  onOpen,
}: {
  root: { id: string; name: string };
  contents: SharedContents;
  onOpen: (id: string) => void;
}) {
  const trail =
    contents.folder.id === root.id
      ? [root]
      : [root, ...contents.ancestors.slice(1), contents.folder];
  if (trail.length === 1) return null;
  return (
    <nav
      aria-label="Folders"
      className="flex items-center gap-1 overflow-x-auto px-4 pt-3 text-sm md:px-6"
    >
      {trail.map((crumb, position) => {
        const last = position === trail.length - 1;
        return (
          <span key={crumb.id} className="flex shrink-0 items-center gap-1">
            {last ? (
              <span className="font-medium">{crumb.name}</span>
            ) : (
              <button
                type="button"
                className="text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                onClick={() => onOpen(crumb.id)}
              >
                {crumb.name}
              </button>
            )}
            {!last && (
              <ChevronRight className="size-3.5 text-muted-foreground/60" />
            )}
          </span>
        );
      })}
    </nav>
  );
}

function DownloadAll({
  token,
  totalBytes,
}: {
  token: string;
  totalBytes: number;
}) {
  const [progress, setProgress] = useState<ArchiveProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);
  useEffect(() => () => abort.current?.abort(), []);

  const start = async () => {
    if (progress) return;
    setError(null);
    abort.current = new AbortController();
    setProgress({ percent: 0, totalBytes, writtenBytes: 0 });
    try {
      await downloadSharedArchive(token, setProgress, abort.current.signal);
    } catch (err) {
      if (!(err instanceof DOMException && err.name === "AbortError")) {
        setError(
          err instanceof ArchiveTooLargeError
            ? "This folder is too big to download as one ZIP. Open it and download files one at a time."
            : errorMessage(err),
        );
      }
    } finally {
      setProgress(null);
      abort.current = null;
    }
  };

  return (
    <div className="flex flex-col items-end gap-1">
      {progress ? (
        <div className="flex w-44 flex-col gap-1">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>Zipping… {Math.round(progress.percent)}%</span>
            <button
              type="button"
              className="underline-offset-2 hover:underline"
              onClick={() => abort.current?.abort()}
            >
              Cancel
            </button>
          </div>
          <Progress value={progress.percent} className="h-1.5" />
        </div>
      ) : (
        <Button size="sm" className="h-8" onClick={() => void start()}>
          <Download className="size-3.5" />
          Download all{totalBytes > 0 ? ` (${formatBytes(totalBytes)})` : ""}
        </Button>
      )}
      {error && (
        <p
          className="max-w-xs text-right text-xs text-destructive"
          role="alert"
        >
          {error}
        </p>
      )}
    </div>
  );
}
