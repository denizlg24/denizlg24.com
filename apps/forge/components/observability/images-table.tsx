"use client";

import { DeploymentKindBadge } from "@repo/cloud-ui/deploy-status";
import { formatBytes, formatRelative } from "@repo/cloud-ui/format";
import type { ForgeImage } from "@repo/schemas/cloud";
import { Badge } from "@repo/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@repo/ui/table";
import { useMemo, useState } from "react";
import { ProjectGroupRow } from "@/components/project-group-ui";
import { groupByProject } from "@/components/project-groups";

const COLUMNS = 6;

/** The Forge image inventory. Filtered by the page, as the containers are. */
export function ImagesTable({
  images,
  project,
}: {
  images: readonly ForgeImage[];
  project: string | null;
}) {
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());

  const groups = useMemo(
    () =>
      groupByProject(images, (image) => ({
        projectSlug: image.projectSlug,
        kind: image.kind,
      })),
    [images],
  );
  const shown = project
    ? groups.filter((group) => group.projectSlug === project)
    : groups;

  const toggle = (slug: string) =>
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(slug)) next.delete(slug);
      else next.add(slug);
      return next;
    });

  function row(image: ForgeImage, inset: boolean) {
    return (
      <TableRow key={image.id}>
        <TableCell
          className={inset ? "pl-9 font-mono text-xs" : "font-mono text-xs"}
        >
          <span className="flex flex-wrap items-center gap-2">
            <span>{image.tags.join(", ") || "<untagged>"}</span>
            {image.kind === "production" || image.kind === "preview" ? (
              <DeploymentKindBadge kind={image.kind} />
            ) : null}
            {/* Not garbage. This is the --cache-from source, so it has no
                container by design and GC can never reap it. */}
            {image.isCacheTag ? (
              <Badge
                variant="ghost"
                className="h-5 rounded-full px-2 py-0 text-[10px] font-normal"
              >
                cache
              </Badge>
            ) : null}
          </span>
        </TableCell>
        <TableCell className="font-mono text-[11px] text-muted-foreground">
          {image.id.replace(/^sha256:/, "").slice(0, 12)}
        </TableCell>
        <TableCell>{formatRelative(image.createdAt)}</TableCell>
        <TableCell className="text-right font-mono tabular-nums">
          {formatBytes(image.sizeBytes)}
        </TableCell>
        <TableCell className="text-right font-mono tabular-nums">
          {image.sharedSizeBytes === null
            ? "—"
            : formatBytes(image.sharedSizeBytes)}
        </TableCell>
        <TableCell className="text-right font-mono tabular-nums">
          {image.containerIds.length}
        </TableCell>
      </TableRow>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>repository tags</TableHead>
          <TableHead>image id</TableHead>
          <TableHead>created</TableHead>
          <TableHead className="text-right">size</TableHead>
          <TableHead className="text-right">shared</TableHead>
          <TableHead className="text-right">containers</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {shown.flatMap((group) => {
          const isCollapsed = collapsed.has(group.projectSlug);
          const bytes = group.all.reduce(
            (sum, image) => sum + image.sizeBytes,
            0,
          );
          return [
            <ProjectGroupRow
              key={`${group.projectSlug}-group`}
              slug={group.projectSlug}
              detail={`${group.all.length} · ${formatBytes(bytes)}`}
              columns={COLUMNS}
              collapsed={isCollapsed}
              onToggle={() => toggle(group.projectSlug)}
            />,
            ...(isCollapsed
              ? []
              : [
                  ...group.production.map((image) => row(image, false)),
                  ...group.previews.map((image) => row(image, true)),
                ]),
          ];
        })}
        {shown.length === 0 ? (
          <TableRow>
            <TableCell
              colSpan={COLUMNS}
              className="h-24 text-center text-xs text-muted-foreground"
            >
              —
            </TableCell>
          </TableRow>
        ) : null}
      </TableBody>
    </Table>
  );
}
