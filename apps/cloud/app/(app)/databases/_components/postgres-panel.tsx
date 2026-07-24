"use client";

import type { PgQueryResult, PgTableDetail } from "@repo/schemas/cloud";
import { Badge } from "@repo/ui/badge";
import { Button } from "@repo/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@repo/ui/dialog";
import { Input } from "@repo/ui/input";
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
import { Textarea } from "@repo/ui/textarea";
import { Lock, Play, Plus, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Section } from "@/components/section";
import { TypedConfirmDialog } from "@/components/typed-confirm-dialog";
import { api, errorMessage } from "@/lib/api";
import { formatBytes, formatDurationMs } from "@/lib/format";
import { usePoll } from "@/lib/use-poll";

function TableDetailDialog({
  database,
  table,
  schema,
  onClose,
}: {
  database: string;
  table: string | null;
  schema: string;
  onClose: () => void;
}) {
  const [detail, setDetail] = useState<PgTableDetail | null>(null);

  useEffect(() => {
    if (!table) return;
    setDetail(null);
    api.pg
      .tableDetail(database, table, schema)
      .then(setDetail)
      .catch((err) => toast.error(errorMessage(err)));
  }, [database, table, schema]);

  return (
    <Dialog open={table !== null} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="font-mono text-sm">
            {schema}.{table}
          </DialogTitle>
        </DialogHeader>
        {detail && (
          <div className="flex flex-col gap-5">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>column</TableHead>
                  <TableHead>type</TableHead>
                  <TableHead>nullable</TableHead>
                  <TableHead>default</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {detail.columns.map((column) => (
                  <TableRow key={column.name}>
                    <TableCell className="font-mono text-xs">
                      {column.name}
                    </TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      {column.type}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {column.nullable ? "yes" : "no"}
                    </TableCell>
                    <TableCell className="max-w-48 truncate font-mono text-xs text-muted-foreground">
                      {column.default ?? "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {detail.indexes.length > 0 && (
              <div className="flex flex-col gap-1">
                <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                  indexes
                </span>
                {detail.indexes.map((index) => (
                  <code
                    key={index.name}
                    className="break-all font-mono text-[11px] text-muted-foreground"
                  >
                    {index.definition}
                  </code>
                ))}
              </div>
            )}
            {detail.constraints.length > 0 && (
              <div className="flex flex-col gap-1">
                <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                  constraints
                </span>
                {detail.constraints.map((constraint) => (
                  <span
                    key={constraint.name}
                    className="font-mono text-[11px] text-muted-foreground"
                  >
                    {constraint.name} · {constraint.type} (
                    {constraint.columns.join(", ")})
                  </span>
                ))}
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function QueryConsole({ database }: { database: string }) {
  const [sql, setSql] = useState("");
  const [result, setResult] = useState<PgQueryResult | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async () => {
    if (sql.trim().length === 0) return;
    setBusy(true);
    try {
      setResult(await api.pg.query(database, sql));
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section title={`query — ${database}`}>
      <div className="flex flex-col gap-3">
        <Textarea
          rows={4}
          className="font-mono text-xs"
          placeholder="select …"
          value={sql}
          onChange={(event) => setSql(event.target.value)}
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
              event.preventDefault();
              void run();
            }
          }}
        />
        <div className="flex items-center gap-3">
          <Button size="sm" disabled={busy} onClick={() => void run()}>
            <Play className="size-3.5" />
            run
          </Button>
          {result && (
            <span className="text-xs tabular-nums text-muted-foreground">
              {result.rowCount} rows · {formatDurationMs(result.durationMs)}
              {result.truncated && " · truncated"}
            </span>
          )}
        </div>
        {result && result.columns.length > 0 && (
          <div className="overflow-x-auto border-y">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  {result.columns.map((column) => (
                    <TableHead key={column} className="font-mono text-xs">
                      {column}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {result.rows.map((row, rowIndex) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: result rows have no stable id
                  <TableRow key={rowIndex}>
                    {result.columns.map((column) => (
                      <TableCell
                        key={column}
                        className="max-w-64 truncate font-mono text-xs"
                        title={String(row[column] ?? "")}
                      >
                        {row[column] === null || row[column] === undefined
                          ? "∅"
                          : String(row[column])}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </Section>
  );
}

export function PostgresPanel() {
  const { data: databases, reload } = usePoll(api.pg.databases, null);
  const [selected, setSelected] = useState<string | null>(null);
  const [schemas, setSchemas] = useState<string[]>([]);
  const [schema, setSchema] = useState("public");
  const [newName, setNewName] = useState("");
  const [detailTable, setDetailTable] = useState<string | null>(null);

  const fetchTables = useCallback(
    () => (selected ? api.pg.tables(selected, schema) : Promise.resolve([])),
    [selected, schema],
  );
  const { data: tables, reload: reloadTables } = usePoll(fetchTables, null);

  useEffect(() => {
    if (!selected) return;
    api.pg
      .schemas(selected)
      .then((rows) => {
        const names = rows.map((row) => row.name);
        setSchemas(names);
        if (!names.includes(schema)) setSchema(names[0] ?? "public");
      })
      .catch((err) => toast.error(errorMessage(err)));
  }, [selected, schema]);

  const createDatabase = async () => {
    try {
      await api.pg.createDatabase(newName.trim());
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
                  onClick={() => setSelected(database.name)}
                >
                  <TableCell className="font-mono text-xs">
                    {database.name}
                    {database.isProtected && (
                      <Lock className="ml-1.5 inline size-3 text-muted-foreground" />
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
                              await api.pg.dropDatabase(database.name);
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
            title={`tables — ${selected}`}
            count={tables?.length}
            actions={
              <Select value={schema} onValueChange={setSchema}>
                <SelectTrigger size="sm" className="h-8 font-mono text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {schemas.map((entry) => (
                    <SelectItem key={entry} value={entry}>
                      {entry}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            }
          >
            <TableDetailDialog
              database={selected}
              table={detailTable}
              schema={schema}
              onClose={() => setDetailTable(null)}
            />
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead>table</TableHead>
                    <TableHead className="text-right">rows</TableHead>
                    <TableHead className="text-right">size</TableHead>
                    <TableHead className="w-10" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(tables ?? []).map((table) => (
                    <TableRow
                      key={`${table.schema}.${table.name}`}
                      className="cursor-pointer"
                      onClick={() => setDetailTable(table.name)}
                    >
                      <TableCell className="font-mono text-xs">
                        {table.name}
                      </TableCell>
                      <TableCell className="text-right text-xs tabular-nums text-muted-foreground">
                        {Math.round(table.rowEstimate)}
                      </TableCell>
                      <TableCell className="text-right text-xs tabular-nums text-muted-foreground">
                        {formatBytes(table.sizeBytes)}
                      </TableCell>
                      <TableCell onClick={(event) => event.stopPropagation()}>
                        <div className="flex justify-end">
                          <TypedConfirmDialog
                            trigger={
                              <Button
                                variant="ghost"
                                size="icon"
                                className="size-7 text-destructive"
                              >
                                <Trash2 className="size-3.5" />
                              </Button>
                            }
                            title={`Drop table ${table.name}?`}
                            keyword={table.name}
                            actionLabel="Drop"
                            onConfirm={async () => {
                              try {
                                await api.pg.dropTable(
                                  selected,
                                  table.name,
                                  table.schema,
                                );
                                void reloadTables();
                              } catch (err) {
                                toast.error(errorMessage(err));
                              }
                            }}
                          />
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                  {tables?.length === 0 && (
                    <TableRow>
                      <TableCell
                        colSpan={4}
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
          <QueryConsole database={selected} />
        </>
      )}
    </div>
  );
}
