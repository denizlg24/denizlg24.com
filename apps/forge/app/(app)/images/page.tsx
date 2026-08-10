"use client";

import { DeploymentKindBadge } from "@repo/cloud-ui/deploy-status";
import { formatBytes, formatRelative } from "@repo/cloud-ui/format";
import { usePoll } from "@repo/cloud-ui/use-poll";
import type { ForgeImage } from "@repo/schemas/cloud";
import { Badge } from "@repo/ui/badge";
import { Skeleton } from "@repo/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@repo/ui/table";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useMemo, useState } from "react";
import { PageHeading } from "@/components/page-heading";
import { api } from "@/lib/api";
import { groupByProject } from "../_components/project-groups";

const COLUMNS = 6;

export default function ImagesPage() {
  const { data, error } = usePoll(api.forge.overview, 30_000);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [project, setProject] = useState<string | null>(null);

  const images = data?.agent?.images ?? [];
  const total = images.reduce((sum, image) => sum + image.sizeBytes, 0);
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
    <div className="flex flex-col gap-6">
      <PageHeading
        title="images"
        detail={
          data
            ? `${images.length} images · ${formatBytes(total)} logical size`
            : "Forge image inventory"
        }
      />
      {!data && !error ? <Skeleton className="h-64" /> : null}
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
      {data ? (
        <>
          {groups.length > 1 ? (
            <div className="flex flex-wrap items-center gap-1">
              <button
                type="button"
                aria-pressed={project === null}
                onClick={() => setProject(null)}
                className={
                  project === null
                    ? "rounded-full bg-foreground px-2 py-0.5 text-[11px] text-background transition-colors"
                    : "rounded-full px-2 py-0.5 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
                }
              >
                all
              </button>
              {groups.map((group) => (
                <button
                  key={group.projectSlug}
                  type="button"
                  aria-pressed={project === group.projectSlug}
                  onClick={() => setProject(group.projectSlug)}
                  className={
                    project === group.projectSlug
                      ? "rounded-full bg-foreground px-2 py-0.5 text-[11px] text-background transition-colors"
                      : "rounded-full px-2 py-0.5 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
                  }
                >
                  {group.projectSlug}
                </button>
              ))}
            </div>
          ) : null}

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
              {shown.map((group) => {
                const isCollapsed = collapsed.has(group.projectSlug);
                const bytes = group.all.reduce(
                  (sum, image) => sum + image.sizeBytes,
                  0,
                );
                return [
                  <TableRow
                    key={`${group.projectSlug}-group`}
                    className="bg-muted/30"
                  >
                    <TableCell colSpan={COLUMNS} className="py-1.5">
                      <button
                        type="button"
                        onClick={() => toggle(group.projectSlug)}
                        aria-expanded={!isCollapsed}
                        className="flex items-center gap-1.5 text-xs font-medium"
                      >
                        {isCollapsed ? (
                          <ChevronRight className="size-3.5 text-muted-foreground" />
                        ) : (
                          <ChevronDown className="size-3.5 text-muted-foreground" />
                        )}
                        {group.projectSlug}
                        <span className="text-[11px] font-normal text-muted-foreground tabular-nums">
                          {group.all.length} · {formatBytes(bytes)}
                        </span>
                      </button>
                    </TableCell>
                  </TableRow>,
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
        </>
      ) : null}
    </div>
  );
}
