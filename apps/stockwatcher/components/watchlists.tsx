"use client";

import { useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
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
import { amount, compact, marketTime, tone } from "@/lib/utils";
import { symbolSchema, type Quote, type Workspace } from "@/lib/models";
import {
  Change,
  Empty,
  Failure,
  Loading,
  PanelHeading,
  quoteTime,
  SectionFoot,
  signed,
  SortHead,
  SymbolLink,
  useSort,
  Tick,
} from "./shared";
import { useQuotes } from "./market-widgets";
import { Field, FormDialog, RemoveDialog, value, type Save } from "./forms";

type List = Workspace["watchlists"][number];
type WatchRow = { ticker: string; quote?: Quote };

const rangePosition = (quote?: Quote) =>
  quote?.yearHigh != null &&
  quote.yearLow != null &&
  quote.yearHigh > quote.yearLow
    ? Math.min(
        100,
        Math.max(
          0,
          ((quote.price - quote.yearLow) / (quote.yearHigh - quote.yearLow)) *
            100,
        ),
      )
    : null;

const watchSort = {
  symbol: (row: WatchRow) => row.ticker,
  name: (row: WatchRow) => row.quote?.name,
  price: (row: WatchRow) => row.quote?.price,
  change: (row: WatchRow) => row.quote?.change,
  percent: (row: WatchRow) => row.quote?.percent,
  range: (row: WatchRow) => rangePosition(row.quote),
  volume: (row: WatchRow) => row.quote?.volume,
};

function YearRange({ quote }: { quote?: Quote }) {
  const position = rangePosition(quote);
  if (position == null || !quote) return <span className="muted">—</span>;
  return (
    <span
      className="year-range"
      title={`52-week low ${amount(quote.yearLow)} · high ${amount(quote.yearHigh)}`}
    >
      <span className="sr-only">{Math.round(position)}% of 52-week range</span>
      <i aria-hidden>
        <b style={{ insetInlineStart: `${position}%` }} />
      </i>
    </span>
  );
}

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
  const rows: WatchRow[] = (current?.symbols ?? []).map((ticker) => ({
    ticker,
    quote: bySymbol.get(ticker),
  }));
  const { sorted, sort, toggle } = useSort(rows, watchSort, {
    key: "symbol",
    dir: "asc",
  });
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
                ? `${current.symbols.length} ${current.symbols.length === 1 ? "symbol" : "symbols"} · day moves vs prior close`
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
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <SortHead
                      label="Symbol"
                      column="symbol"
                      sort={sort}
                      toggle={toggle}
                    />
                    <SortHead
                      className="col-mid"
                      label="Company"
                      column="name"
                      sort={sort}
                      toggle={toggle}
                    />
                    <SortHead
                      label="Last"
                      column="price"
                      sort={sort}
                      toggle={toggle}
                      numeric
                    />
                    <TableHead>Ccy</TableHead>
                    <SortHead
                      label="Change"
                      column="change"
                      sort={sort}
                      toggle={toggle}
                      numeric
                    />
                    <SortHead
                      label="Day %"
                      column="percent"
                      sort={sort}
                      toggle={toggle}
                      numeric
                    />
                    <SortHead
                      className="col-wide"
                      label="52w range"
                      column="range"
                      sort={sort}
                      toggle={toggle}
                      numeric
                    />
                    <SortHead
                      className="col-wide"
                      label="Volume"
                      column="volume"
                      sort={sort}
                      toggle={toggle}
                      numeric
                    />
                    <TableHead className="text-right col-wide">Time</TableHead>
                    <TableHead>
                      <span className="sr-only">Actions</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sorted.map(({ ticker, quote }) => (
                    <TableRow key={ticker}>
                      <TableCell>
                        <SymbolLink
                          symbol={ticker}
                          select={select}
                          label={quote?.name}
                        />
                      </TableCell>
                      <TableCell className="truncate-cell col-mid">
                        {quote?.name ?? (
                          <span className="muted">Unavailable</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right strong-cell">
                        <Tick value={quote?.price} />
                      </TableCell>
                      <TableCell className="muted">
                        {quote?.currency ?? ""}
                      </TableCell>
                      <TableCell
                        className={`text-right ${tone(quote?.change)}`}
                      >
                        {signed(quote?.change)}
                      </TableCell>
                      <TableCell className="text-right">
                        <Change value={quote?.percent} />
                      </TableCell>
                      <TableCell className="text-right col-wide">
                        <YearRange quote={quote} />
                      </TableCell>
                      <TableCell className="text-right muted col-wide">
                        {compact(quote?.volume)}
                      </TableCell>
                      <TableCell
                        className="text-right muted col-wide"
                        title={quote ? marketTime(quote.time) : undefined}
                      >
                        {quoteTime(quote?.time)}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          size="icon-xs"
                          variant="ghost"
                          aria-label={`Remove ${ticker}`}
                          onClick={() => setRemove(ticker)}
                        >
                          <Trash2 />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <SectionFoot>
                <span>
                  {data?.source ?? "Market data"} · prices in each listing’s
                  quote currency
                </span>
                {data?.missing.length ? (
                  <span>Unavailable: {data.missing.join(", ")}</span>
                ) : null}
              </SectionFoot>
            </>
          ) : (
            <Empty title={current ? "No symbols yet" : "No watchlist yet"}>
              {current ? (
                "Add tickers to get their latest prices and day moves."
              ) : (
                <>
                  <p>
                    Group the names you follow to see live quotes, day moves
                    and headlines side by side.
                  </p>
                  <Button
                    size="sm"
                    variant="outline"
                    className="empty-action"
                    onClick={() => setEditor("new")}
                  >
                    <Plus /> Create a watchlist
                  </Button>
                </>
              )}
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
