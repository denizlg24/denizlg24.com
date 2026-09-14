"use client";

import {
  formatBytes,
  formatDateTime,
  formatRelative,
} from "@repo/cloud-ui/format";
import type {
  FolderContents,
  FolderCrumb,
  StorageFile,
} from "@repo/schemas/cloud";
import { Button } from "@repo/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@repo/ui/dropdown-menu";
import { ResponsiveDialog } from "@repo/ui/responsive-dialog";
import { cn } from "@repo/ui/utils";
import { useQuery } from "@tanstack/react-query";
import {
  ChevronLeft,
  ChevronRight,
  Download,
  FolderInput,
  FolderOpen,
  Info,
  Link2,
  MoreHorizontal,
  Pencil,
  Trash2,
  X,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { crumbLabel } from "@/app/(app)/folders/[id]/_components/breadcrumbs";
import { MovePicker } from "@/app/(app)/folders/[id]/_components/move-picker";
import { ShareSheet } from "@/app/(app)/folders/[id]/_components/share-sheet";
import { api } from "@/lib/api";
import { fileIcon, fileKind, kindColorClass, kindLabel } from "@/lib/file-kind";
import { keys } from "@/lib/folder-cache";
import { FilePreview } from "./file-preview";
import { useSession } from "./session-provider";
import { Thumbnail } from "./thumbnail";

const SWIPE_PX = 60;

function thumbnailUrl(
  file: StorageFile,
  width: 256 | 512 | 1024,
): string | null {
  return file.thumbnail
    ? api.url.thumbnail(file.id, width, file.updatedAt)
    : null;
}

/**
 * Full-viewport file view: the renderer centred on a dark scrim, the file's
 * neighbours along the bottom, and every action a person could want on the
 * file in one header. Arrow keys and swipes walk the folder; Esc closes.
 */
export function Lightbox({
  files,
  fileId,
  folderId,
  folder,
  ancestors,
  onSelect,
  onClose,
  onDelete,
  onRename,
  onMove,
}: {
  files: StorageFile[];
  fileId: string;
  folderId: string;
  folder: FolderContents["folder"] | null;
  ancestors: FolderCrumb[];
  onSelect: (id: string) => void;
  onClose: () => void;
  onDelete?: (file: StorageFile) => void;
  onRename?: (file: StorageFile) => void;
  onMove?: (file: StorageFile, targetFolderId: string) => void;
}) {
  const index = files.findIndex((file) => file.id === fileId);
  const file = index >= 0 ? files[index] : undefined;
  const previous = index > 0 ? files[index - 1] : undefined;
  const next =
    index >= 0 && index < files.length - 1 ? files[index + 1] : undefined;
  const [details, setDetails] = useState(false);
  const [panel, setPanel] = useState<"share" | "move" | null>(null);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        panel !== null
      ) {
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        if (details) setDetails(false);
        else onClose();
      }
      if (event.key === "ArrowLeft" && previous) {
        event.preventDefault();
        onSelect(previous.id);
      }
      if (event.key === "ArrowRight" && next) {
        event.preventDefault();
        onSelect(next.id);
      }
      if (event.key === "i" && !event.metaKey && !event.ctrlKey) {
        event.preventDefault();
        setDetails((value) => !value);
      }
    };
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [onClose, onSelect, previous, next, details, panel]);

  // The overlay owns the viewport while it is open, and focus has to follow it
  // in — otherwise Tab keeps walking the browser behind the overlay and screen
  // readers never enter the dialog. Focus goes back where it came from on
  // close so keyboard position is not lost.
  const containerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    const previouslyFocused = document.activeElement;
    document.body.style.overflow = "hidden";
    containerRef.current?.focus();
    return () => {
      document.body.style.overflow = previousOverflow;
      if (previouslyFocused instanceof HTMLElement) previouslyFocused.focus();
    };
  }, []);

  // The file can vanish underneath the overlay — deleted here, or renamed and
  // refetched. Closing properly also clears the ?preview= parameter, which a
  // bare `return null` would leave behind in a shareable URL.
  const missing = index < 0 && files.length > 0;
  useEffect(() => {
    if (missing) onClose();
  }, [missing, onClose]);

  // Swipe between neighbours. Only a mostly-horizontal, fast enough move
  // counts, so a scroll inside a PDF or a pinch never flips the file.
  const touchStart = useRef<{ x: number; y: number; at: number } | null>(null);
  const swipeHandlers = {
    onTouchStart: (event: React.TouchEvent) => {
      if (event.touches.length !== 1) {
        touchStart.current = null;
        return;
      }
      const touch = event.touches[0];
      if (touch) {
        touchStart.current = {
          at: Date.now(),
          x: touch.clientX,
          y: touch.clientY,
        };
      }
    },
    onTouchEnd: (event: React.TouchEvent) => {
      const start = touchStart.current;
      touchStart.current = null;
      const touch = event.changedTouches[0];
      if (!start || !touch || Date.now() - start.at > 600) return;
      const dx = touch.clientX - start.x;
      const dy = touch.clientY - start.y;
      if (Math.abs(dx) < SWIPE_PX || Math.abs(dy) > Math.abs(dx)) return;
      if (dx < 0 && next) onSelect(next.id);
      if (dx > 0 && previous) onSelect(previous.id);
    },
  };

  // Keep the current thumbnail in view along the filmstrip.
  const stripRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    stripRef.current
      ?.querySelector<HTMLElement>(`[data-strip-id="${fileId}"]`)
      ?.scrollIntoView({ block: "nearest", inline: "center" });
  }, [fileId]);

  if (!file) return null;
  const kind = fileKind(file.filename, file.mimeType);

  return (
    <div
      ref={containerRef}
      tabIndex={-1}
      className="fixed inset-0 z-50 flex flex-col bg-black/95 text-white outline-none animate-in fade-in duration-150"
      role="dialog"
      aria-modal="true"
      aria-label={file.filename}
    >
      <header className="flex h-14 shrink-0 items-center gap-1 px-2 sm:px-3">
        <div className="min-w-0 flex-1 px-1">
          <p className="truncate text-sm font-medium" title={file.filename}>
            {file.filename}
          </p>
          <p className="truncate text-xs text-white/60">
            {files.length > 1 ? `${index + 1} of ${files.length} · ` : ""}
            {formatBytes(file.sizeBytes)}
          </p>
        </div>
        <LightboxButton label="Share" onClick={() => setPanel("share")}>
          <Link2 className="size-4" />
        </LightboxButton>
        <LightboxButton label="Download" asChild>
          <a href={api.url.fileDownload(file.id)} download={file.filename}>
            <Download className="size-4" />
          </a>
        </LightboxButton>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="size-9 text-white hover:bg-white/10 hover:text-white"
              aria-label="More actions"
            >
              <MoreHorizontal className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            {onRename && (
              <DropdownMenuItem onSelect={() => onRename(file)}>
                <Pencil className="size-4" />
                Rename
              </DropdownMenuItem>
            )}
            {onMove && (
              <DropdownMenuItem
                onSelect={() => setTimeout(() => setPanel("move"), 0)}
              >
                <FolderInput className="size-4" />
                Move to…
              </DropdownMenuItem>
            )}
            <DropdownMenuItem asChild>
              <Link href={`/folders/${folderId}`} onClick={onClose}>
                <FolderOpen className="size-4" />
                Open folder
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setDetails((value) => !value)}>
              <Info className="size-4" />
              {details ? "Hide details" : "Details"}
            </DropdownMenuItem>
            {onDelete && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  variant="destructive"
                  onSelect={() => {
                    onDelete(file);
                    if (next) onSelect(next.id);
                    else if (previous) onSelect(previous.id);
                    else onClose();
                  }}
                >
                  <Trash2 className="size-4" />
                  Delete
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
        <LightboxButton label="Close" onClick={onClose}>
          <X className="size-5" />
        </LightboxButton>
      </header>

      <div className="flex min-h-0 flex-1">
        <div
          className="relative flex min-h-0 min-w-0 flex-1 flex-col text-foreground"
          {...swipeHandlers}
        >
          <div
            className="flex min-h-0 flex-1 flex-col"
            style={{ viewTransitionName: "lightbox-media" }}
          >
            <FilePreview
              key={file.id}
              url={api.url.file(file.id)}
              downloadUrl={api.url.fileDownload(file.id)}
              filename={file.filename}
              mimeType={file.mimeType}
              sizeBytes={file.sizeBytes}
              poster={thumbnailUrl(file, 1024)}
            />
          </div>
          {previous && (
            <Button
              variant="ghost"
              size="icon"
              aria-label="Previous file"
              className="absolute left-2 top-1/2 hidden size-10 -translate-y-1/2 rounded-full bg-black/50 text-white hover:bg-black/70 hover:text-white md:flex"
              onClick={() => onSelect(previous.id)}
            >
              <ChevronLeft className="size-5" />
            </Button>
          )}
          {next && (
            <Button
              variant="ghost"
              size="icon"
              aria-label="Next file"
              className="absolute right-2 top-1/2 hidden size-10 -translate-y-1/2 rounded-full bg-black/50 text-white hover:bg-black/70 hover:text-white md:flex"
              onClick={() => onSelect(next.id)}
            >
              <ChevronRight className="size-5" />
            </Button>
          )}
        </div>

        {details && (
          <aside className="w-full max-w-xs shrink-0 overflow-y-auto border-l border-white/10 bg-black/60 p-4 text-sm">
            <Details
              file={file}
              folder={folder}
              ancestors={ancestors}
              folderId={folderId}
              onClose={onClose}
            />
          </aside>
        )}
      </div>

      {files.length > 1 && (
        <div
          ref={stripRef}
          className="scrollbar-thin hidden h-[4.5rem] shrink-0 items-center gap-1.5 overflow-x-auto px-3 md:flex"
        >
          {files.map((candidate) => (
            <button
              key={candidate.id}
              type="button"
              data-strip-id={candidate.id}
              aria-label={candidate.filename}
              aria-current={candidate.id === fileId ? "true" : undefined}
              onClick={() => onSelect(candidate.id)}
              className={cn(
                "size-14 shrink-0 overflow-hidden rounded-md ring-offset-black transition-opacity",
                candidate.id === fileId
                  ? "opacity-100 ring-2 ring-white ring-offset-2"
                  : "opacity-60 hover:opacity-100",
              )}
            >
              <Thumbnail
                src={thumbnailUrl(candidate, 256)}
                alt=""
                fallback={fileIcon(candidate.filename, candidate.mimeType)}
                className="size-full rounded-none bg-white/10"
                iconClassName={cn(
                  "size-6",
                  kindColorClass(
                    fileKind(candidate.filename, candidate.mimeType),
                  ),
                )}
              />
            </button>
          ))}
        </div>
      )}

      <ResponsiveDialog
        open={panel === "share"}
        onOpenChange={(open) => !open && setPanel(null)}
        title={`Share “${file.filename}”`}
        className="max-w-md"
      >
        {panel === "share" && (
          <ShareSheet fileId={file.id} filename={file.filename} />
        )}
      </ResponsiveDialog>
      <ResponsiveDialog
        open={panel === "move"}
        onOpenChange={(open) => !open && setPanel(null)}
        title={`Move “${file.filename}”`}
        className="max-w-md"
      >
        {panel === "move" && onMove && (
          <MovePicker
            entries={[{ id: file.id, name: file.filename, type: "file" }]}
            sourceFolderId={folderId}
            busy={false}
            onMove={(targetFolderId) => {
              setPanel(null);
              onMove(file, targetFolderId);
              if (next) onSelect(next.id);
              else if (previous) onSelect(previous.id);
              else onClose();
            }}
          />
        )}
      </ResponsiveDialog>
      <p className="sr-only">
        {kind === "image" ? "Pinch or double-tap to zoom. " : ""}Press i for
        details, Escape to close.
      </p>
    </div>
  );
}

function LightboxButton({
  label,
  onClick,
  asChild,
  children,
}: {
  label: string;
  onClick?: () => void;
  asChild?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Button
      variant="ghost"
      size="icon"
      className="size-9 text-white hover:bg-white/10 hover:text-white"
      aria-label={label}
      title={label}
      onClick={onClick}
      asChild={asChild}
    >
      {children}
    </Button>
  );
}

function Details({
  file,
  folder,
  ancestors,
  folderId,
  onClose,
}: {
  file: StorageFile;
  folder: FolderContents["folder"] | null;
  ancestors: FolderCrumb[];
  folderId: string;
  onClose: () => void;
}) {
  const { user } = useSession();
  const people = useQuery({
    queryKey: keys.people,
    queryFn: () => api.people(),
    staleTime: Number.POSITIVE_INFINITY,
  });
  const detail = useQuery({
    queryKey: keys.file(file.id),
    queryFn: () => api.file(file.id),
    enabled: user.role === "superuser",
    staleTime: 60_000,
  });
  const addedBy = file.ownerId
    ? (people.data?.find((person) => person.id === file.ownerId)?.username ??
      (file.ownerId === user.id ? user.username : null))
    : null;
  const trail = folder ? [...ancestors, folder] : ancestors;

  return (
    <dl className="grid grid-cols-[6rem_1fr] gap-x-3 gap-y-2.5">
      <dt className="text-white/60">Kind</dt>
      <dd>{kindLabel(file.filename, file.mimeType)}</dd>
      <dt className="text-white/60">Size</dt>
      <dd className="tabular-nums">{formatBytes(file.sizeBytes)}</dd>
      <dt className="text-white/60">Added by</dt>
      <dd>{addedBy ?? "—"}</dd>
      <dt className="text-white/60">Added on</dt>
      <dd>{formatDateTime(file.createdAt)}</dd>
      <dt className="text-white/60">Modified</dt>
      <dd title={formatDateTime(file.updatedAt)}>
        {formatRelative(file.updatedAt)}
      </dd>
      <dt className="text-white/60">Location</dt>
      <dd className="flex flex-wrap items-center gap-x-1 gap-y-0.5">
        {trail.map((crumb, position) => (
          <span key={crumb.id} className="flex items-center gap-1">
            <Link
              href={`/folders/${crumb.id}`}
              onClick={onClose}
              className={cn(
                "underline-offset-2 hover:underline",
                crumb.id === folderId && "font-medium",
              )}
            >
              {crumbLabel(crumb)}
            </Link>
            {position < trail.length - 1 && (
              <ChevronRight className="size-3 text-white/40" />
            )}
          </span>
        ))}
      </dd>
      {user.role === "superuser" && (
        <>
          <dt className="mt-3 text-white/60">Path</dt>
          <dd className="mt-3 break-all font-mono text-xs">{file.path}</dd>
          <dt className="text-white/60">Id</dt>
          <dd className="break-all font-mono text-xs">{file.id}</dd>
          <dt className="text-white/60">Stored on</dt>
          <dd className="uppercase">{file.tier}</dd>
          <dt className="text-white/60">Checksum</dt>
          <dd className="break-all font-mono text-xs">
            {detail.data?.checksum ?? "…"}
          </dd>
          <dt className="text-white/60">Opened</dt>
          <dd className="tabular-nums">
            {detail.data
              ? `${detail.data.accessCount}× · ${detail.data.lastAccessedAt ? formatRelative(detail.data.lastAccessedAt) : "never"}`
              : "…"}
          </dd>
        </>
      )}
    </dl>
  );
}
