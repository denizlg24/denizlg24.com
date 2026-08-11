"use client";

import { formatRelative } from "@repo/cloud-ui/format";
import { usePoll } from "@repo/cloud-ui/use-poll";
import type { SafeProjectCollection } from "@repo/schemas/cloud";
import { Button } from "@repo/ui/button";
import { ConfirmButton } from "@repo/ui/confirm-button";
import { Section } from "@repo/ui/section";
import { StatusDot, type StatusTone } from "@repo/ui/status-dot";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@repo/ui/table";
import {
  Pause,
  Play,
  RefreshCw,
  SlidersHorizontal,
  Trash2,
} from "lucide-react";
import { useCallback, useState } from "react";
import { toast } from "sonner";
import { api, errorMessage } from "@/lib/api";
import { CollectionCreateDialog } from "./collection-create-dialog";
import { FieldMappingDialog } from "./field-mapping-dialog";

function syncTone(collection: SafeProjectCollection): StatusTone {
  if (!collection.syncEnabled) return "muted";
  if (collection.syncStatus === "error") return "critical";
  if (collection.syncStatus === "syncing") return "warning";
  return "good";
}

function sourceLabel(collection: SafeProjectCollection): string {
  return collection.sourceType === "mongodb"
    ? `${collection.mongoDatabase}.${collection.mongoCollection}`
    : `${collection.pgDatabase}.${collection.pgSchema}.${collection.pgTable}`;
}

export function CollectionsSection({ projectId }: { projectId: string }) {
  const fetchCollections = useCallback(
    () => api.projects.collections.list(projectId),
    [projectId],
  );
  const { data: collections, reload } = usePoll(fetchCollections, 30_000);
  const [mappingFor, setMappingFor] = useState<SafeProjectCollection | null>(
    null,
  );

  const act = async (action: () => Promise<unknown>) => {
    try {
      await action();
      void reload();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  return (
    <Section
      title="search collections"
      count={collections?.length}
      actions={
        <CollectionCreateDialog
          projectId={projectId}
          onCreated={() => void reload()}
        />
      }
    >
      <FieldMappingDialog
        projectId={projectId}
        collection={mappingFor}
        onClose={() => setMappingFor(null)}
        onSaved={() => void reload()}
      />
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>name</TableHead>
              <TableHead>source</TableHead>
              <TableHead>sync</TableHead>
              <TableHead className="text-right">docs</TableHead>
              <TableHead className="text-right">synced</TableHead>
              <TableHead className="w-32" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {(collections ?? []).map((collection) => (
              <TableRow key={collection.id}>
                <TableCell className="font-mono text-xs">
                  {collection.name}
                </TableCell>
                <TableCell className="font-mono text-xs text-muted-foreground">
                  <span title={collection.meiliIndexUid}>
                    {collection.sourceType} · {sourceLabel(collection)}
                  </span>
                </TableCell>
                <TableCell>
                  <span
                    className="flex items-center gap-1.5 text-xs text-muted-foreground"
                    title={collection.lastError ?? undefined}
                  >
                    <StatusDot tone={syncTone(collection)} />
                    {collection.syncEnabled ? collection.syncStatus : "paused"}
                  </span>
                </TableCell>
                <TableCell className="text-right text-xs tabular-nums">
                  {collection.documentCount}
                </TableCell>
                <TableCell className="text-right text-xs tabular-nums text-muted-foreground">
                  {formatRelative(collection.lastSyncedAt)}
                </TableCell>
                <TableCell>
                  <div className="flex justify-end gap-0.5">
                    <Button
                      aria-label={`${collection.syncEnabled ? "Pause" : "Resume"} sync for ${collection.name}`}
                      variant="ghost"
                      size="icon"
                      className="size-7"
                      title={collection.syncEnabled ? "pause" : "resume"}
                      onClick={() =>
                        void act(() =>
                          api.projects.collections.update(
                            projectId,
                            collection.id,
                            { syncEnabled: !collection.syncEnabled },
                          ),
                        )
                      }
                    >
                      {collection.syncEnabled ? (
                        <Pause className="size-3.5" />
                      ) : (
                        <Play className="size-3.5" />
                      )}
                    </Button>
                    <Button
                      aria-label={`Resync ${collection.name}`}
                      variant="ghost"
                      size="icon"
                      className="size-7"
                      title="resync"
                      onClick={() =>
                        void act(() =>
                          api.projects.collections.resync(
                            projectId,
                            collection.id,
                          ),
                        )
                      }
                    >
                      <RefreshCw className="size-3.5" />
                    </Button>
                    <Button
                      aria-label={`Field mapping for ${collection.name}`}
                      variant="ghost"
                      size="icon"
                      className="size-7"
                      title="field mapping"
                      onClick={() => setMappingFor(collection)}
                    >
                      <SlidersHorizontal className="size-3.5" />
                    </Button>
                    <ConfirmButton
                      trigger={
                        <Button
                          aria-label={`Delete collection ${collection.name}`}
                          variant="ghost"
                          size="icon"
                          className="size-7 text-destructive"
                        >
                          <Trash2 className="size-3.5" />
                        </Button>
                      }
                      title={`Delete collection ${collection.name}?`}
                      description="The search index is removed."
                      actionLabel="Delete"
                      onConfirm={() =>
                        act(() =>
                          api.projects.collections.remove(
                            projectId,
                            collection.id,
                          ),
                        )
                      }
                    />
                  </div>
                </TableCell>
              </TableRow>
            ))}
            {collections?.length === 0 && (
              <TableRow>
                <TableCell
                  colSpan={6}
                  className="h-12 text-center text-xs text-muted-foreground"
                >
                  —
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </Section>
  );
}
