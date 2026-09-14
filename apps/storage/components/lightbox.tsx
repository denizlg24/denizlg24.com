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
  ChevronRight,
  Download,
  FolderInput,
  FolderOpen,
  Info,
  Link2,
  MoreHorizontal,
  Pencil,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { crumbLabel } from "@/app/(app)/folders/[id]/_components/breadcrumbs";
import { MovePicker } from "@/app/(app)/folders/[id]/_components/move-picker";
import { ShareSheet } from "@/app/(app)/folders/[id]/_components/share-sheet";
import { api } from "@/lib/api";
import { kindLabel } from "@/lib/file-kind";
import { keys } from "@/lib/folder-cache";
import { FilePreview } from "./file-preview";
import { LightboxButton, LightboxFrame } from "./lightbox-frame";
import { useSession } from "./session-provider";

function thumbnailUrl(
  file: StorageFile,
  width: 256 | 512 | 1024,
): string | null {
  return file.thumbnail
    ? api.url.thumbnail(file.id, width, file.updatedAt)
    : null;
}

/**
 * The signed-in file view: the frame's chrome plus every action a person
 * could want on the file — share, download, rename, move, delete — and the
 * details pane with where it lives and who added it.
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

  const stepAway = () => {
    if (next) onSelect(next.id);
    else if (previous) onSelect(previous.id);
    else onClose();
  };

  return (
    <LightboxFrame
      items={files}
      itemId={fileId}
      onSelect={onSelect}
      onClose={onClose}
      thumbnail={thumbnailUrl}
      detailsOpen={details}
      onToggleDetails={() => setDetails((value) => !value)}
      keyboardPaused={panel !== null}
      aside={
        file && (
          <Details
            file={file}
            folder={folder}
            ancestors={ancestors}
            folderId={folderId}
            onClose={onClose}
          />
        )
      }
      actions={
        file && (
          <>
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
                <DropdownMenuItem
                  onSelect={() => setDetails((value) => !value)}
                >
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
                        stepAway();
                      }}
                    >
                      <Trash2 className="size-4" />
                      Delete
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
            <ResponsiveDialog
              open={panel === "share"}
              onOpenChange={(open) => !open && setPanel(null)}
              title={`Share “${file.filename}”`}
              className="max-w-md"
            >
              {panel === "share" && (
                <ShareSheet
                  target={{ id: file.id, kind: "file", name: file.filename }}
                />
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
                    stepAway();
                  }}
                />
              )}
            </ResponsiveDialog>
          </>
        )
      }
    >
      {(current) => (
        <FilePreview
          key={current.id}
          url={api.url.file(current.id)}
          downloadUrl={api.url.fileDownload(current.id)}
          filename={current.filename}
          mimeType={current.mimeType}
          sizeBytes={current.sizeBytes}
          poster={thumbnailUrl(current, 1024)}
        />
      )}
    </LightboxFrame>
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
