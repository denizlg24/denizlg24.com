"use client";

import { formatBytes, formatDurationMs } from "@repo/cloud-ui/format";
import { usePoll } from "@repo/cloud-ui/use-poll";
import type { PgQueryResult, PgTableDetail } from "@repo/schemas/cloud";
import { Button } from "@repo/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@repo/ui/dialog";
import { Section } from "@repo/ui/section";
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
import { TypedConfirmDialog } from "@repo/ui/typed-confirm-dialog";
import { Lock, Play, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { api, errorMessage } from "@/lib/api";

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
    let cancelled = false;
    setDetail(null);
    api.pg
      .tableDetail(database, table, schema)
      .then((next) => {
        if (!cancelled) setDetail(next);
      })
      .catch((err) => {
        if (!cancelled) toast.error(errorMessage(err));
      });
    return () => {
      cancelled = true;
    };
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
  const { data: databases } = usePoll(api.pg.databases, null);
  const [selected, setSelected] = useState<string | null>(null);
  const [schemas, setSchemas] = useState<string[]>([]);
  const [schema, setSchema] = useState("public");
  const [detailTable, setDetailTable] = useState<string | null>(null);

  const fetchTables = useCallback(
    () => (selected ? api.pg.tables(selected, schema) : Promise.resolve([])),
    [selected, schema],
  );
  const { data: tables, reload: reloadTables } = usePoll(fetchTables, null);

  useEffect(() => {
    if (!selected) return;
    let cancelled = false;
    api.pg
      .schemas(selected)
      .then((rows) => {
        if (cancelled) return;
        const names = rows.map((row) => row.name);
        setSchemas(names);
        // Functional update, so picking a schema doesn't refetch this list.
        setSchema((current) =>
          names.includes(current) ? current : (names[0] ?? "public"),
        );
      })
      .catch((err) => {
        if (!cancelled) toast.error(errorMessage(err));
      });
    return () => {
      cancelled = true;
    };
  }, [selected]);

  return (
    <div className="flex flex-col gap-8">
      {/* Read-only: what this daemon is carrying, and how big. Creating and
          dropping a database is a resource operation and lives in Forge, where
          the connections that make one reachable are. */}
      <Section title="databases" count={databases?.length}>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>name</TableHead>
                <TableHead className="text-right">size</TableHead>
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
                                aria-label={`Drop table ${table.name}`}
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
