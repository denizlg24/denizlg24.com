"use client";

import type { VectorQuantization, VectorSimilarity } from "@repo/schemas/cloud";
import { Button } from "@repo/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@repo/ui/dialog";
import { Input } from "@repo/ui/input";
import { Label } from "@repo/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@repo/ui/select";
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
import { ConfirmButton } from "@/components/confirm-button";
import { Section } from "@/components/section";
import { StatusDot } from "@/components/status-dot";
import { api, errorMessage } from "@/lib/api";
import { usePoll } from "@/lib/use-poll";

const SIMILARITIES: VectorSimilarity[] = ["cosine", "euclidean", "dotProduct"];
const QUANTIZATIONS: VectorQuantization[] = ["none", "scalar", "binary"];

export function VectorIndexesSection({ projectId }: { projectId: string }) {
  const fetchOverview = useCallback(
    () => api.projects.vectorIndexes.overview(projectId),
    [projectId],
  );
  const { data: overview, error, reload } = usePoll(fetchOverview, null);

  const [open, setOpen] = useState(false);
  const [collection, setCollection] = useState("");
  const [name, setName] = useState("");
  const [path, setPath] = useState("embedding");
  const [dimensions, setDimensions] = useState("1536");
  const [similarity, setSimilarity] = useState<VectorSimilarity>("cosine");
  const [quantization, setQuantization] = useState<VectorQuantization>("none");
  const [filterPaths, setFilterPaths] = useState("");
  const [busy, setBusy] = useState(false);

  const create = async () => {
    setBusy(true);
    try {
      await api.projects.vectorIndexes.create(projectId, {
        collection,
        name: name.trim(),
        path: path.trim(),
        numDimensions: Number(dimensions),
        similarity,
        quantization,
        filterPaths: filterPaths
          .split(/[,\n]/)
          .map((entry) => entry.trim())
          .filter((entry) => entry.length > 0),
      });
      setOpen(false);
      setName("");
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
            <DialogContent className="sm:max-w-sm">
              <DialogHeader>
                <DialogTitle>Create vector index</DialogTitle>
              </DialogHeader>
              <div className="flex flex-col gap-4">
                <div className="flex flex-col gap-1.5">
                  <Label className="text-xs">Collection</Label>
                  <Select
                    value={collection || undefined}
                    onValueChange={setCollection}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="—" />
                    </SelectTrigger>
                    <SelectContent>
                      {(overview?.collections ?? []).map((entry) => (
                        <SelectItem key={entry} value={entry}>
                          {entry}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="vector-name" className="text-xs">
                    Name
                  </Label>
                  <Input
                    id="vector-name"
                    className="font-mono text-sm"
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="vector-path" className="text-xs">
                      Path
                    </Label>
                    <Input
                      id="vector-path"
                      className="font-mono text-sm"
                      value={path}
                      onChange={(event) => setPath(event.target.value)}
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="vector-dims" className="text-xs">
                      Dimensions
                    </Label>
                    <Input
                      id="vector-dims"
                      inputMode="numeric"
                      className="font-mono text-sm"
                      value={dimensions}
                      onChange={(event) => setDimensions(event.target.value)}
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="flex flex-col gap-1.5">
                    <Label className="text-xs">Similarity</Label>
                    <Select
                      value={similarity}
                      onValueChange={(value) =>
                        setSimilarity(value as VectorSimilarity)
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {SIMILARITIES.map((entry) => (
                          <SelectItem key={entry} value={entry}>
                            {entry}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label className="text-xs">Quantization</Label>
                    <Select
                      value={quantization}
                      onValueChange={(value) =>
                        setQuantization(value as VectorQuantization)
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {QUANTIZATIONS.map((entry) => (
                          <SelectItem key={entry} value={entry}>
                            {entry}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="vector-filters" className="text-xs">
                    Filter paths
                  </Label>
                  <Input
                    id="vector-filters"
                    className="font-mono text-sm"
                    placeholder="a, b.c"
                    value={filterPaths}
                    onChange={(event) => setFilterPaths(event.target.value)}
                  />
                </div>
                <Button
                  disabled={
                    busy ||
                    !collection ||
                    name.trim().length === 0 ||
                    path.trim().length === 0 ||
                    !Number.isInteger(Number(dimensions)) ||
                    Number(dimensions) < 1
                  }
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
