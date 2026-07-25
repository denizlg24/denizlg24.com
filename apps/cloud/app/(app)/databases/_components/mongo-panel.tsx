"use client";

import { formatBytes, formatDurationMs } from "@repo/cloud-ui/format";
import { usePoll } from "@repo/cloud-ui/use-poll";
import type { MongoFindResult, MongoIndex } from "@repo/schemas/cloud";
import { Button } from "@repo/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@repo/ui/dialog";
import { Input } from "@repo/ui/input";
import { Section } from "@repo/ui/section";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@repo/ui/table";
import { TypedConfirmDialog } from "@repo/ui/typed-confirm-dialog";
import { Lock, Play, Plus, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { api, errorMessage } from "@/lib/api";

function IndexesDialog({
  database,
  collection,
  onClose,
}: {
  database: string;
  collection: string | null;
  onClose: () => void;
}) {
  const [indexes, setIndexes] = useState<MongoIndex[] | null>(null);

  useEffect(() => {
    if (!collection) return;
    let cancelled = false;
    setIndexes(null);
    api.mongo
      .indexes(database, collection)
      .then((rows) => {
        if (!cancelled) setIndexes(rows);
      })
      .catch((err) => {
        if (!cancelled) toast.error(errorMessage(err));
      });
    return () => {
      cancelled = true;
    };
  }, [database, collection]);

  return (
    <Dialog
      open={collection !== null}
      onOpenChange={(next) => !next && onClose()}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-mono text-sm">
            {database}.{collection} — indexes
          </DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-1.5">
          {(indexes ?? []).map((index) => (
            <div
              key={index.name}
              className="flex items-center justify-between gap-3"
            >
              <code className="font-mono text-xs">
                {index.name}
                <span className="ml-2 text-muted-foreground">
                  {JSON.stringify(index.key)}
                </span>
              </code>
              <span className="text-[11px] text-muted-foreground">
                {[index.unique && "unique", index.sparse && "sparse"]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
            </div>
          ))}
          {indexes?.length === 0 && (
            <span className="text-xs text-muted-foreground">—</span>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function FindConsole({
  database,
  collection,
}: {
  database: string;
  collection: string;
}) {
  const [filter, setFilter] = useState("");
  const [result, setResult] = useState<MongoFindResult | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async () => {
    setBusy(true);
    try {
      setResult(
        await api.mongo.find(database, collection, {
          filter: filter.trim() || undefined,
          limit: 20,
          skip: 0,
        }),
      );
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section title={`find — ${database}.${collection}`}>
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <Input
            className="flex-1 font-mono text-xs"
            placeholder='{"field": "value"}'
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") void run();
            }}
          />
          <Button size="sm" disabled={busy} onClick={() => void run()}>
            <Play className="size-3.5" />
            find
          </Button>
        </div>
        {result && (
          <>
            <span className="text-xs tabular-nums text-muted-foreground">
              {result.totalCount} matching ·{" "}
              {formatDurationMs(result.durationMs)}
            </span>
            <div className="flex max-h-96 flex-col gap-2 overflow-y-auto">
              {result.documents.map((document, index) => (
                <pre
                  key={index}
                  className="overflow-x-auto rounded bg-muted px-2 py-1.5 font-mono text-[11px] leading-relaxed"
                >
                  {JSON.stringify(document, null, 1)}
                </pre>
              ))}
            </div>
          </>
        )}
      </div>
    </Section>
  );
}

export function MongoPanel() {
  const { data: databases, reload } = usePoll(api.mongo.databases, null);
  const [selected, setSelected] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [indexesFor, setIndexesFor] = useState<string | null>(null);
  const [findFor, setFindFor] = useState<string | null>(null);

  const fetchCollections = useCallback(
    () => (selected ? api.mongo.collections(selected) : Promise.resolve([])),
    [selected],
  );
  const { data: collections, reload: reloadCollections } = usePoll(
    fetchCollections,
    null,
  );

  const createDatabase = async () => {
    try {
      await api.mongo.createDatabase(newName.trim());
      setNewName("");
      void reload();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  return (
    <div className="flex flex-col gap-8">
      <Section
        title="databases"
        count={databases?.length}
        actions={
          <div className="flex items-center gap-2">
            <Input
              placeholder="name"
              className="h-8 w-40 font-mono text-xs"
              value={newName}
              onChange={(event) => setNewName(event.target.value)}
            />
            <Button
              size="sm"
              variant="ghost"
              disabled={newName.trim().length === 0}
              onClick={() => void createDatabase()}
            >
              <Plus className="size-3.5" />
            </Button>
          </div>
        }
      >
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>name</TableHead>
                <TableHead className="text-right">size</TableHead>
                <TableHead className="w-16" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {(databases ?? []).map((database) => (
                <TableRow
                  key={database.name}
                  data-state={selected === database.name ? "selected" : ""}
                  className="cursor-pointer"
                  onClick={() => {
                    setSelected(database.name);
                    setFindFor(null);
                  }}
                >
                  <TableCell className="font-mono text-xs">
                    {database.name}
                    {database.isProtected && (
                      <Lock className="ml-1.5 inline size-3 text-muted-foreground" />
                    )}
                    {database.empty && (
                      <span className="ml-1.5 text-muted-foreground">
                        empty
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-right text-xs tabular-nums text-muted-foreground">
                    {formatBytes(database.sizeBytes)}
                  </TableCell>
                  <TableCell onClick={(event) => event.stopPropagation()}>
                    <div className="flex justify-end">
                      {!database.isProtected && (
                        <TypedConfirmDialog
                          trigger={
                            <Button
                              aria-label={`Drop database ${database.name}`}
                              variant="ghost"
                              size="icon"
                              className="size-7 text-destructive"
                            >
                              <Trash2 className="size-3.5" />
                            </Button>
                          }
                          title={`Drop database ${database.name}?`}
                          keyword={database.name}
                          actionLabel="Drop"
                          onConfirm={async () => {
                            try {
                              await api.mongo.dropDatabase(database.name);
                              if (selected === database.name) setSelected(null);
                              void reload();
                            } catch (err) {
                              toast.error(errorMessage(err));
                            }
                          }}
                        />
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </Section>

      {selected && (
        <>
          <Section
            title={`collections — ${selected}`}
            count={collections?.length}
          >
            <IndexesDialog
              database={selected}
              collection={indexesFor}
              onClose={() => setIndexesFor(null)}
            />
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead>collection</TableHead>
                    <TableHead className="text-right">docs</TableHead>
                    <TableHead className="text-right">size</TableHead>
                    <TableHead className="text-right">indexes</TableHead>
                    <TableHead className="w-24" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(collections ?? []).map((collection) => (
                    <TableRow
                      key={collection.name}
                      className="cursor-pointer"
                      onClick={() => setFindFor(collection.name)}
                    >
                      <TableCell className="font-mono text-xs">
                        {collection.name}
                      </TableCell>
                      <TableCell className="text-right text-xs tabular-nums text-muted-foreground">
                        {collection.documentCount}
                      </TableCell>
                      <TableCell className="text-right text-xs tabular-nums text-muted-foreground">
                        {formatBytes(collection.sizeBytes)}
                      </TableCell>
                      <TableCell className="text-right text-xs tabular-nums text-muted-foreground">
                        {collection.indexCount}
                      </TableCell>
                      <TableCell onClick={(event) => event.stopPropagation()}>
                        <div className="flex justify-end gap-0.5">
                          <Button
                            aria-label={`Indexes for ${collection.name}`}
                            variant="ghost"
                            size="icon"
                            className="size-7"
                            title="indexes"
                            onClick={() => setIndexesFor(collection.name)}
                          >
                            <span className="font-mono text-[10px]">ix</span>
                          </Button>
                          <TypedConfirmDialog
                            trigger={
                              <Button
                                aria-label={`Drop collection ${collection.name}`}
                                variant="ghost"
                                size="icon"
                                className="size-7 text-destructive"
                              >
                                <Trash2 className="size-3.5" />
                              </Button>
                            }
                            title={`Drop collection ${collection.name}?`}
                            keyword={collection.name}
                            actionLabel="Drop"
                            onConfirm={async () => {
                              try {
                                await api.mongo.dropCollection(
                                  selected,
                                  collection.name,
                                );
                                if (findFor === collection.name)
                                  setFindFor(null);
                                void reloadCollections();
                              } catch (err) {
                                toast.error(errorMessage(err));
                              }
                            }}
                          />
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                  {collections?.length === 0 && (
                    <TableRow>
                      <TableCell
                        colSpan={5}
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
          {findFor && <FindConsole database={selected} collection={findFor} />}
        </>
      )}
    </div>
  );
}
