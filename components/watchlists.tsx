"use client";

import { useState } from "react";
import { ArrowRight, Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { amount, compact, marketTime } from "@/lib/utils";
import { symbolSchema, type Workspace } from "@/lib/models";
import { Change, Empty, Failure, Loading, PanelHeading } from "./shared";
import { useQuotes } from "./market-widgets";
import { Field, FormDialog, RemoveDialog, value, type Save } from "./forms";

type List = Workspace["watchlists"][number];

export function AddSymbolDialog({
  lists,
  listId,
  initial,
  close,
  save,
}: {
  lists: List[];
  listId: string;
  initial?: string;
  close: () => void;
  save: Save;
}) {
  return (
    <FormDialog
      title="Add to watchlist"
      description="Enter a ticker or several tickers separated by commas."
      close={close}
      label="Add symbols"
      submit={async (fields) => {
        const symbols = value(fields, "symbols")
          .split(/[,\s]+/)
          .filter(Boolean)
          .map((item) => symbolSchema.parse(item));
        if (!symbols.length) throw new Error("Enter at least one ticker.");
        const id = value(fields, "list");
        await save((workspace) => ({
          ...workspace,
          watchlists: workspace.watchlists.map((list) =>
            list.id === id
              ? {
                  ...list,
                  symbols: [...new Set([...list.symbols, ...symbols])],
                }
              : list,
          ),
        }));
      }}
    >
      <Field label="Ticker symbols">
        <Input
          name="symbols"
          defaultValue={initial}
          placeholder="AAPL, ASML.AS"
          maxLength={600}
          required
        />
      </Field>
      <Field label="Watchlist">
        <select name="list" defaultValue={listId || lists[0]?.id} required>
          {lists.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </select>
      </Field>
    </FormDialog>
  );
}

export function ListEditor({
  list,
  close,
  save,
  created,
}: {
  list?: List;
  close: () => void;
  save: Save;
  created?: (id: string) => void;
}) {
  return (
    <FormDialog
      title={list ? "Rename watchlist" : "New watchlist"}
      description={
        list
          ? "Update the name shown in your workspace."
          : "Group the symbols you want to follow together."
      }
      close={close}
      label={list ? "Rename" : "Create watchlist"}
      submit={async (fields) => {
        const name = value(fields, "name");
        if (!name) throw new Error("Enter a name.");
        const id = list?.id ?? crypto.randomUUID();
        await save((workspace) => ({
          ...workspace,
          watchlists: list
            ? workspace.watchlists.map((item) =>
                item.id === id ? { ...item, name } : item,
              )
            : [...workspace.watchlists, { id, name, symbols: [] }],
        }));
        created?.(id);
      }}
    >
      <Field label="Name">
        <Input
          name="name"
          defaultValue={list?.name}
          placeholder="Long-term ideas"
          maxLength={120}
          required
        />
      </Field>
    </FormDialog>
  );
}

export function Watchlists({
  lists,
  listId,
  setList,
  add,
  save,
  select,
  refresh,
}: {
  lists: List[];
  listId: string;
  setList: (id: string) => void;
  add: () => void;
  save: Save;
  select: (ticker: string) => void;
  refresh: boolean;
}) {
  const [editor, setEditor] = useState<"new" | "edit" | "delete" | null>(null);
  const [remove, setRemove] = useState("");
  const current = lists.find((list) => list.id === listId) ?? lists[0];
  const { data, error, mutate, isLoading } = useQuotes(
    current?.symbols ?? [],
    refresh,
  );
  const bySymbol = new Map(data?.quotes.map((item) => [item.symbol, item]));
  return (
    <>
      <div className="view-grid">
        <section className="panel collection-panel">
          <PanelHeading title="Lists">
            <Button
              size="icon-sm"
              variant="ghost"
              onClick={() => setEditor("new")}
              aria-label="New watchlist"
            >
              <Plus />
            </Button>
          </PanelHeading>
          <div className="collection-list">
            {lists.map((item) => (
              <button
                key={item.id}
                onClick={() => setList(item.id)}
                className={current?.id === item.id ? "active" : ""}
              >
                <span>{item.name}</span>
                <span>{item.symbols.length}</span>
              </button>
            ))}
          </div>
          {!lists.length ? (
            <Empty title="No watchlists">
              Create a list to start following stocks.
            </Empty>
          ) : null}
        </section>
        <section className="panel detail-panel">
          <PanelHeading
            title={current?.name ?? "Watchlist"}
            subtitle={
              current
                ? `${current.symbols.length} symbols${data?.source ? ` · ${data.source}` : ""}`
                : undefined
            }
          >
            {current ? (
              <div className="row-actions">
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Rename watchlist"
                  onClick={() => setEditor("edit")}
                >
                  <Pencil />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Delete watchlist"
                  onClick={() => setEditor("delete")}
                >
                  <Trash2 />
                </Button>
                <Button size="sm" onClick={add}>
                  <Plus /> Add symbols
                </Button>
              </div>
            ) : null}
          </PanelHeading>
          <Failure error={error} retry={mutate} />
          {isLoading ? (
            <Loading />
          ) : current?.symbols.length ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Symbol</TableHead>
                  <TableHead>Company</TableHead>
                  <TableHead className="text-right">Last</TableHead>
                  <TableHead className="text-right">Session</TableHead>
                  <TableHead className="text-right">Volume</TableHead>
                  <TableHead>Quote time</TableHead>
                  <TableHead>
                    <span className="sr-only">Actions</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {current.symbols.map((ticker) => {
                  const quote = bySymbol.get(ticker);
                  return (
                    <TableRow key={ticker}>
                      <TableCell>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => select(ticker)}
                        >
                          {ticker} <ArrowRight />
                        </Button>
                      </TableCell>
                      <TableCell>{quote?.name ?? "Unavailable"}</TableCell>
                      <TableCell className="text-right">
                        {amount(quote?.price)} {quote?.currency}
                      </TableCell>
                      <TableCell className="text-right">
                        <Change value={quote?.percent} />
                      </TableCell>
                      <TableCell className="text-right">
                        {compact(quote?.volume)}
                      </TableCell>
                      <TableCell>
                        {quote ? marketTime(quote.time) : "—"}
                      </TableCell>
                      <TableCell>
                        <Button
                          size="icon-sm"
                          variant="ghost"
                          aria-label={`Remove ${ticker}`}
                          onClick={() => setRemove(ticker)}
                        >
                          <Trash2 />
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          ) : (
            <Empty title={current ? "No symbols yet" : "Choose a watchlist"}>
              {current
                ? "Add tickers to get their latest prices and session moves."
                : "Your lists will appear here."}
            </Empty>
          )}
        </section>
      </div>
      {editor === "new" || (editor === "edit" && current) ? (
        <ListEditor
          list={editor === "edit" ? current : undefined}
          close={() => setEditor(null)}
          save={save}
          created={setList}
        />
      ) : null}
      {editor === "delete" && current ? (
        <RemoveDialog
          item={current.name}
          close={() => setEditor(null)}
          remove={() =>
            save((workspace) => ({
              ...workspace,
              watchlists: workspace.watchlists.filter(
                (item) => item.id !== current.id,
              ),
            }))
          }
        />
      ) : null}
      {remove && current ? (
        <RemoveDialog
          item={remove}
          close={() => setRemove("")}
          remove={() =>
            save((workspace) => ({
              ...workspace,
              watchlists: workspace.watchlists.map((item) =>
                item.id === current.id
                  ? {
                      ...item,
                      symbols: item.symbols.filter(
                        (ticker) => ticker !== remove,
                      ),
                    }
                  : item,
              ),
            }))
          }
        />
      ) : null}
    </>
  );
}
