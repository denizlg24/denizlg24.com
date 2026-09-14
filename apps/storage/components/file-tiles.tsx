"use client";

import { formatBytes, formatRelative } from "@repo/cloud-ui/format";
import { thumbnailKindFor } from "@repo/schemas/cloud";
import { Folder } from "lucide-react";
import type { ComponentProps } from "react";
import { api } from "@/lib/api";
import { fileIcon, fileKind, kindColorClass } from "@/lib/file-kind";
import { type Density, Tile } from "./tile";

/** The subset of a file a read-only tile needs; search hits, recent rows and share listings all provide it. */
export interface TileFile {
  id: string;
  name: string;
  mimeType: string | null;
  sizeBytes: number;
  updatedAt: string;
  /** Known from the listing; derived from the name when absent. */
  thumbnail?: boolean;
  /** Where the thumbnail comes from: the signed-in API by default. */
  thumbnailSrc?: string | null;
}

export function fileTileProps(file: TileFile, meta?: string) {
  const kind = fileKind(file.name, file.mimeType);
  const canThumbnail =
    file.thumbnail ??
    thumbnailKindFor({
      filename: file.name,
      mimeType: file.mimeType,
      sizeBytes: file.sizeBytes,
    }) !== null;
  return {
    badge:
      kind === "video"
        ? "Video"
        : kind === "audio"
          ? "Audio"
          : kind === "pdf"
            ? "PDF"
            : undefined,
    icon: fileIcon(file.name, file.mimeType),
    iconClassName: kindColorClass(kind),
    meta:
      meta ??
      `${formatBytes(file.sizeBytes)} · ${formatRelative(file.updatedAt)}`,
    name: file.name,
    thumbnailSrc:
      file.thumbnailSrc !== undefined
        ? file.thumbnailSrc
        : canThumbnail
          ? api.url.thumbnail(file.id, 256, file.updatedAt)
          : null,
  };
}

/** A file tile that opens on click. Used outside the browser, where there is no selection. */
export function FileTile({
  file,
  meta,
  density = "comfortable",
  ...rest
}: {
  file: TileFile;
  meta?: string;
  density?: Density;
} & Omit<ComponentProps<"li">, "children">) {
  return (
    <Tile
      {...rest}
      {...fileTileProps(file, meta)}
      density={density}
      className="cursor-pointer"
    />
  );
}

export function FolderTile({
  name,
  meta,
  density = "comfortable",
  ...rest
}: {
  name: string;
  meta: string;
  density?: Density;
} & Omit<ComponentProps<"li">, "children">) {
  return (
    <Tile
      {...rest}
      name={name}
      meta={meta}
      icon={Folder}
      iconClassName={`${kindColorClass("folder")} fill-current`}
      thumbnailSrc={null}
      density={density}
      className="cursor-pointer"
    />
  );
}
