"use client";

import type { CollectionSourceType } from "@repo/schemas/cloud";
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
import { Plus } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { api, errorMessage } from "@/lib/api";

function PgPicker({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: string[];
  onChange: (value: string) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label className="text-xs">{label}</Label>
      <Select value={value || undefined} onValueChange={onChange}>
        <SelectTrigger>
          <SelectValue placeholder="—" />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option} value={option}>
              {option}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

export function CollectionCreateDialog({
  projectId,
  onCreated,
}: {
  projectId: string;
  onCreated: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [sourceType, setSourceType] = useState<CollectionSourceType>("mongodb");
  const [mongoDatabase, setMongoDatabase] = useState("");
  const [mongoCollection, setMongoCollection] = useState("");
  const [pgDatabase, setPgDatabase] = useState("");
  const [pgSchema, setPgSchema] = useState("");
  const [pgTable, setPgTable] = useState("");
  const [pgIdColumn, setPgIdColumn] = useState("id");
  const [pgDatabases, setPgDatabases] = useState<string[]>([]);
  const [pgSchemas, setPgSchemas] = useState<string[]>([]);
  const [pgTables, setPgTables] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open || sourceType !== "postgres") return;
    api.projects.pgSources
      .databases(projectId)
      .then(setPgDatabases)
      .catch((err) => toast.error(errorMessage(err)));
  }, [open, sourceType, projectId]);

  useEffect(() => {
    if (!pgDatabase) return;
    setPgSchemas([]);
    setPgSchema("");
    api.projects.pgSources
      .schemas(projectId, pgDatabase)
      .then(setPgSchemas)
      .catch((err) => toast.error(errorMessage(err)));
  }, [pgDatabase, projectId]);

  useEffect(() => {
    if (!pgDatabase || !pgSchema) return;
    setPgTables([]);
    setPgTable("");
    api.projects.pgSources
      .tables(projectId, pgDatabase, pgSchema)
      .then(setPgTables)
      .catch((err) => toast.error(errorMessage(err)));
  }, [pgDatabase, pgSchema, projectId]);

  const valid =
    name.trim().length > 0 &&
    (sourceType === "mongodb"
      ? mongoDatabase.length > 0 && mongoCollection.length > 0
      : pgDatabase.length > 0 &&
        pgSchema.length > 0 &&
        pgTable.length > 0 &&
        pgIdColumn.length > 0);

  const create = async () => {
    setBusy(true);
    try {
      await api.projects.collections.create(
        projectId,
        sourceType === "mongodb"
          ? {
              name: name.trim(),
              sourceType: "mongodb",
              mongoDatabase,
              mongoCollection,
            }
          : {
              name: name.trim(),
              sourceType: "postgres",
              pgDatabase,
              pgSchema,
              pgTable,
              pgIdColumn,
            },
      );
      setOpen(false);
      setName("");
      onCreated();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="ghost">
          <Plus className="size-3.5" />
          collection
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Create search collection</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="collection-name" className="text-xs">
              Name
            </Label>
            <Input
              id="collection-name"
              autoFocus
              className="font-mono text-sm"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs">Source</Label>
            <Select
              value={sourceType}
              onValueChange={(value) =>
                setSourceType(value as CollectionSourceType)
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="mongodb">mongodb</SelectItem>
                <SelectItem value="postgres">postgres</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {sourceType === "mongodb" ? (
            <>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="mongo-db" className="text-xs">
                  Database
                </Label>
                <Input
                  id="mongo-db"
                  className="font-mono text-sm"
                  value={mongoDatabase}
                  onChange={(event) => setMongoDatabase(event.target.value)}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="mongo-coll" className="text-xs">
                  Collection
                </Label>
                <Input
                  id="mongo-coll"
                  className="font-mono text-sm"
                  value={mongoCollection}
                  onChange={(event) => setMongoCollection(event.target.value)}
                />
              </div>
            </>
          ) : (
            <>
              <PgPicker
                label="Database"
                value={pgDatabase}
                options={pgDatabases}
                onChange={setPgDatabase}
              />
              <PgPicker
                label="Schema"
                value={pgSchema}
                options={pgSchemas}
                onChange={setPgSchema}
              />
              <PgPicker
                label="Table"
                value={pgTable}
                options={pgTables}
                onChange={setPgTable}
              />
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="pg-id-column" className="text-xs">
                  Id column
                </Label>
                <Input
                  id="pg-id-column"
                  className="font-mono text-sm"
                  value={pgIdColumn}
                  onChange={(event) => setPgIdColumn(event.target.value)}
                />
              </div>
            </>
          )}
          <Button disabled={busy || !valid} onClick={() => void create()}>
            Create
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
