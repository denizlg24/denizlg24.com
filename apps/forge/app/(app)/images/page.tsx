"use client";

import { formatBytes, formatRelative } from "@repo/cloud-ui/format";
import { usePoll } from "@repo/cloud-ui/use-poll";
import { Skeleton } from "@repo/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@repo/ui/table";
import { PageHeading } from "@/components/page-heading";
import { api } from "@/lib/api";

export default function ImagesPage() {
  const { data, error } = usePoll(api.forge.overview, 30_000);
  const images = data?.agent?.images ?? [];
  const total = images.reduce((sum, image) => sum + image.sizeBytes, 0);
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
            {images.map((image) => (
              <TableRow key={image.id}>
                <TableCell className="font-mono text-xs">
                  {image.tags.join(", ") || "<untagged>"}
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
            ))}
            {images.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={6}
                  className="h-24 text-center text-xs text-muted-foreground"
                >
                  no Forge images
                </TableCell>
              </TableRow>
            ) : null}
          </TableBody>
        </Table>
      ) : null}
    </div>
  );
}
