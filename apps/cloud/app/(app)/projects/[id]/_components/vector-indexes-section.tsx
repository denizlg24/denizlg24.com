"use client";

import { usePoll } from "@repo/cloud-ui/use-poll";
import {
  type CreateProjectVectorIndexInput,
  createProjectVectorIndexInputSchema,
} from "@repo/schemas/cloud";
import { Button } from "@repo/ui/button";
import { ConfirmButton } from "@repo/ui/confirm-button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@repo/ui/dialog";
import { Section } from "@repo/ui/section";
import { StatusDot } from "@repo/ui/status-dot";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@repo/ui/table";
import { Plus, Trash2 } from "lucide-react";
import { useCallback, useState } from "react";
import { toast } from "sonner";
import { JsonEditor, useJsonDraft } from "@/components/json-editor";
import { api, errorMessage } from "@/lib/api";

const TEMPLATES = [
  {
    label: "basic",
    value: {
      collection: "",
      name: "",
      path: "embedding",
      numDimensions: 1536,
      similarity: "cosine",
      quantization: "none",
      filterPaths: [],
    },
  },
  {
    label: "filtered",
    value: {
      collection: "",
      name: "",
      path: "embedding",
      numDimensions: 1536,
      similarity: "cosine",
      quantization: "scalar",
      filterPaths: ["tenantId"],
    },
  },
] as const;

const TEMPLATE = TEMPLATES[0].value;

export function VectorIndexesSection({ projectId }: { projectId: string }) {
  const fetchOverview = useCallback(
    () => api.projects.vectorIndexes.overview(projectId),
    [projectId],
  );
  const { data: overview, error, reload } = usePoll(fetchOverview, null);

  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const draft = useJsonDraft<CreateProjectVectorIndexInput>(
    createProjectVectorIndexInputSchema,
    TEMPLATE,
  );

  const create = async () => {
    if (!draft.result.ok) return;
    setBusy(true);
    try {
      await api.projects.vectorIndexes.create(projectId, draft.result.data);
      setOpen(false);
      draft.reset(TEMPLATE);
      void reload();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const mongotReady = overview?.mongot.status === "ready";

  return (
    <Section
      title="vector indexes"
      count={overview?.indexes.length}
      actions={
        <div className="flex items-center gap-3">
          {overview && (
            <span
              className="flex items-center gap-1.5 text-xs text-muted-foreground"
              title={overview.mongot.message}
            >
              <StatusDot tone={mongotReady ? "good" : "critical"} />
              mongot
            </span>
          )}
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button size="sm" variant="ghost" disabled={!mongotReady}>
                <Plus className="size-3.5" />
                index
              </Button>
            </DialogTrigger>
            <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-2xl">
              <DialogHeader>
                <DialogTitle>Create vector index</DialogTitle>
              </DialogHeader>
              <div className="flex min-w-0 flex-col gap-3">
                <JsonEditor
                  id="vector-index-json"
                  draft={draft}
                  rows={14}
                  templates={TEMPLATES}
                />
                <div className="flex flex-col gap-1 border-t pt-3">
                  <span className="text-[11px] text-muted-foreground">
                    collections
                  </span>
                  <div className="min-w-0 break-all font-mono text-[11px] text-muted-foreground">
                    {(overview?.collections ?? []).join(" ") || "—"}
                  </div>
                </div>
                <Button
                  disabled={busy || !draft.result.ok}
                  onClick={() => void create()}
                >
                  Create
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      }
    >
      {error && <p className="text-xs text-destructive">{error}</p>}
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>name</TableHead>
              <TableHead>collection</TableHead>
              <TableHead>path</TableHead>
              <TableHead className="text-right">dims</TableHead>
              <TableHead>similarity</TableHead>
              <TableHead>status</TableHead>
              <TableHead className="w-10" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {(overview?.indexes ?? []).map((index) => (
              <TableRow key={`${index.collection}:${index.name}`}>
                <TableCell className="font-mono text-xs">
                  {index.name}
                </TableCell>
                <TableCell className="font-mono text-xs text-muted-foreground">
                  {index.collection}
                </TableCell>
                <TableCell className="font-mono text-xs text-muted-foreground">
                  {index.path}
                </TableCell>
                <TableCell className="text-right text-xs tabular-nums">
                  {index.numDimensions}
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {index.similarity}
                  {index.quantization !== "none" && ` · ${index.quantization}`}
                </TableCell>
                <TableCell>
                  <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <StatusDot tone={index.queryable ? "good" : "warning"} />
                    {index.status.toLowerCase()}
                  </span>
                </TableCell>
                <TableCell>
                  <div className="flex justify-end">
                    <ConfirmButton
                      trigger={
                        <Button
                          aria-label={`Delete index ${index.name}`}
                          variant="ghost"
                          size="icon"
                          className="size-7 text-destructive"
                        >
                          <Trash2 className="size-3.5" />
                        </Button>
                      }
                      title={`Delete index ${index.name}?`}
                      actionLabel="Delete"
                      onConfirm={async () => {
                        try {
                          await api.projects.vectorIndexes.remove(
                            projectId,
                            index.collection,
                            index.name,
                          );
                          void reload();
                        } catch (err) {
                          toast.error(errorMessage(err));
                        }
                      }}
                    />
                  </div>
                </TableCell>
              </TableRow>
            ))}
            {overview?.indexes.length === 0 && (
              <TableRow>
                <TableCell
                  colSpan={7}
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
