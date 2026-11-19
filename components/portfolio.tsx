"use client";

import { useMemo, useState } from "react";
import {
  ArrowDownToLine,
  ArrowRight,
  ArrowUpFromLine,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import Papa from "papaparse";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { amount, number, today, tone } from "@/lib/utils";
import { workspaceSchema, type Trade, type Workspace } from "@/lib/models";
import { positionsFor, valuePosition } from "@/lib/portfolio";
import { Empty, Failure, PanelHeading } from "./shared";
import { useQuotes } from "./market-widgets";
import { Field, FormDialog, RemoveDialog, value, type Save } from "./forms";

const tradeSchema = workspaceSchema.shape.trades.element;
const columns = [
  "date",
  "symbol",
  "side",
  "quantity",
  "price",
  "currency",
  "fees",
];

function parseTrade(
  fields: Record<string, string>,
  bookId: string,
  id = crypto.randomUUID(),
): Trade {
  const result = tradeSchema.safeParse({
    id,
    bookId,
    date: fields.date,
    symbol: fields.symbol,
    side: fields.side?.toLowerCase(),
    quantity: Number(fields.quantity),
    price: Number(fields.price),
    currency:
      fields.currency === "GBp" ? "GBp" : fields.currency?.toUpperCase(),
    fees: Number(fields.fees || "0"),
  });
  if (!result.success)
    throw new Error(
      `Check ${result.error.issues[0]?.path.join(" ")} for ${fields.symbol || "this transaction"}.`,
    );
  return result.data;
}

function downloadCsv(filename: string, text: string) {
  const link = document.createElement("a");
  const url = URL.createObjectURL(
    new Blob([text], { type: "text/csv;charset=utf-8" }),
  );
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export function Portfolio({
  workspace,
  save,
  select,
  refresh,
}: {
  workspace: Workspace;
  save: Save;
  select: (ticker: string) => void;
  refresh: boolean;
}) {
  const [selected, setSelected] = useState("");
  const book =
    workspace.books.find((item) => item.id === selected) ?? workspace.books[0];
  const [dialog, setDialog] = useState<
    | "trade"
    | "import"
    | "book"
    | "rename"
    | "remove-book"
    | "remove-trade"
    | null
  >(null);
  const [trade, setTrade] = useState<Trade>();
  const trades = useMemo(
    () => workspace.trades.filter((item) => item.bookId === book?.id),
    [workspace.trades, book?.id],
  );
  const positions = useMemo(() => positionsFor(trades), [trades]);
  const open = positions.filter((item) => item.quantity > 0);
  const { data, error, mutate } = useQuotes(
    open.map((item) => item.symbol).slice(0, 120),
    refresh,
  );
  const quoteBySymbol = new Map(
    data?.quotes.map((item) => [item.symbol, item]),
  );
  const values = open.map((item) => ({
    ...item,
    ...valuePosition(item, quoteBySymbol.get(item.symbol)),
  }));
  const totals = [...new Set(positions.map((item) => item.currency))].map(
    (currency) => {
      const match = values.filter((item) => item.currency === currency);
      return {
        currency,
        value: match.reduce((sum, item) => sum + (item.marketValue ?? 0), 0),
        missing: match.filter((item) => item.marketValue == null).length,
        count: match.length,
        unrealized: match.reduce(
          (sum, item) => sum + (item.unrealized ?? 0),
          0,
        ),
        realized: positions
          .filter((item) => item.currency === currency)
          .reduce((sum, item) => sum + item.realized, 0),
      };
    },
  );
  const totalByCurrency = new Map(
    totals.map((total) => [total.currency, total]),
  );
  const close = () => {
    setDialog(null);
    setTrade(undefined);
  };
  const exportTrades = () =>
    downloadCsv(
      "stockwatcher-transactions.csv",
      Papa.unparse(trades, { columns, escapeFormulae: true }),
    );
  return (
    <>
      <div className="view-grid">
        <section className="panel collection-panel">
          <PanelHeading title="Portfolios">
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="New portfolio"
              onClick={() => setDialog("book")}
            >
              <Plus />
            </Button>
          </PanelHeading>
          <div className="collection-list">
            {workspace.books.map((item) => (
              <button
                key={item.id}
                className={book?.id === item.id ? "active" : ""}
                onClick={() => setSelected(item.id)}
              >
                <span>{item.name}</span>
                <span>
                  {
                    workspace.trades.filter((row) => row.bookId === item.id)
                      .length
                  }
                </span>
              </button>
            ))}
          </div>
          {!workspace.books.length ? (
            <Empty title="No portfolios">
              Create a portfolio to track transactions.
            </Empty>
          ) : null}
        </section>
        <section className="panel detail-panel">
          <PanelHeading
            title={book?.name ?? "Portfolio"}
            subtitle="Average cost and position weights by quote currency"
          >
            {book ? (
              <div className="row-actions">
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Rename portfolio"
                  onClick={() => setDialog("rename")}
                >
                  <Pencil />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Delete portfolio"
                  onClick={() => setDialog("remove-book")}
                >
                  <Trash2 />
                </Button>
                <Button size="sm" onClick={() => setDialog("trade")}>
                  <Plus /> Record trade
                </Button>
              </div>
            ) : null}
          </PanelHeading>
          {totals.length ? (
            <div className="portfolio-totals">
              {totals.map((item) => (
                <div key={item.currency}>
                  <span>
                    {item.currency} market value
                    {item.missing ? " · partial" : ""}
                  </span>
                  <strong>
                    {item.missing && item.missing === item.count
                      ? "—"
                      : amount(item.value)}
                  </strong>
                  <small>
                    Realized P/L{" "}
                    <b className={tone(item.realized)}>
                      {amount(item.realized)}
                    </b>{" "}
                    · Unrealized P/L{" "}
                    <b className={tone(item.unrealized)}>
                      {item.missing === item.count && item.count
                        ? "—"
                        : amount(item.unrealized)}
                    </b>
                  </small>
                </div>
              ))}
            </div>
          ) : null}
          <Failure error={error} retry={mutate} />
          {book ? (
            <Tabs defaultValue="positions" className="detail-tabs">
              <div className="tabs-bar">
                <TabsList variant="line">
                  <TabsTrigger value="positions">Positions</TabsTrigger>
                  <TabsTrigger value="ledger">Transactions</TabsTrigger>
                </TabsList>
                <div className="row-actions">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setDialog("import")}
                  >
                    <ArrowUpFromLine /> Import CSV
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={exportTrades}
                    disabled={!trades.length}
                  >
                    <ArrowDownToLine /> Export
                  </Button>
                </div>
              </div>
              <TabsContent value="positions">
                {values.length ? (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Symbol</TableHead>
                        <TableHead className="text-right">Shares</TableHead>
                        <TableHead className="text-right">Avg cost</TableHead>
                        <TableHead className="text-right">Last</TableHead>
                        <TableHead className="text-right">Value</TableHead>
                        <TableHead className="text-right">Weight</TableHead>
                        <TableHead className="text-right">Day P/L</TableHead>
                        <TableHead className="text-right">
                          Unrealized P/L
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {values.map((item) => {
                        const total = totalByCurrency.get(item.currency);
                        const weight =
                          total?.value &&
                          !total.missing &&
                          item.marketValue != null
                            ? (item.marketValue / total.value) * 100
                            : null;
                        return (
                          <TableRow key={`${item.symbol}/${item.currency}`}>
                            <TableCell>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => select(item.symbol)}
                              >
                                {item.symbol}
                                <ArrowRight />
                              </Button>
                              <small className="muted">{item.currency}</small>
                            </TableCell>
                            <TableCell className="text-right">
                              {number(item.quantity)}
                            </TableCell>
                            <TableCell className="text-right">
                              {amount(item.cost / item.quantity)}
                            </TableCell>
                            <TableCell className="text-right">
                              {amount(item.price)}
                            </TableCell>
                            <TableCell className="text-right">
                              {amount(item.marketValue)}
                            </TableCell>
                            <TableCell className="text-right">
                              {weight == null ? "—" : `${number(weight)}%`}
                            </TableCell>
                            <TableCell
                              className={`text-right ${tone(item.dayChange)}`}
                            >
                              {amount(item.dayChange)}
                            </TableCell>
                            <TableCell
                              className={`text-right ${tone(item.unrealized)}`}
                            >
                              {amount(item.unrealized)}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                ) : (
                  <Empty title="No open positions">
                    Record a buy or import your transaction history.
                  </Empty>
                )}
                {values.some((item) => item.marketValue == null) ? (
                  <p className="muted detail-note">
                    Values require a current quote in the trade currency. Totals
                    exclude positions with missing or mismatched quotes.
                  </p>
                ) : null}
              </TabsContent>
              <TabsContent value="ledger">
                {trades.length ? (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Date</TableHead>
                        <TableHead>Symbol</TableHead>
                        <TableHead>Side</TableHead>
                        <TableHead className="text-right">Shares</TableHead>
                        <TableHead className="text-right">Price</TableHead>
                        <TableHead className="text-right">Fees</TableHead>
                        <TableHead>
                          <span className="sr-only">Actions</span>
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {trades
                        .toSorted((a, b) => b.date.localeCompare(a.date))
                        .map((item) => (
                          <TableRow key={item.id}>
                            <TableCell>{item.date}</TableCell>
                            <TableCell>{item.symbol}</TableCell>
                            <TableCell className="capitalize">
                              {item.side}
                            </TableCell>
                            <TableCell className="text-right">
                              {number(item.quantity)}
                            </TableCell>
                            <TableCell className="text-right">
                              {amount(item.price)} {item.currency}
                            </TableCell>
                            <TableCell className="text-right">
                              {amount(item.fees)}
                            </TableCell>
                            <TableCell>
                              <div className="row-actions">
                                <Button
                                  variant="ghost"
                                  size="icon-sm"
                                  aria-label={`Edit ${item.symbol} transaction`}
                                  onClick={() => {
                                    setTrade(item);
                                    setDialog("trade");
                                  }}
                                >
                                  <Pencil />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="icon-sm"
                                  aria-label={`Delete ${item.symbol} transaction`}
                                  onClick={() => {
                                    setTrade(item);
                                    setDialog("remove-trade");
                                  }}
                                >
                                  <Trash2 />
                                </Button>
                              </div>
                            </TableCell>
                          </TableRow>
                        ))}
                    </TableBody>
                  </Table>
                ) : (
                  <Empty title="No transactions">
                    The ledger records buys, sells, and fees.
                  </Empty>
                )}
              </TabsContent>
            </Tabs>
          ) : null}
        </section>
      </div>
      {book && dialog === "trade" ? (
        <FormDialog
          title={trade ? "Edit transaction" : "Record a trade"}
          description={`Update the transaction ledger for ${book.name}.`}
          close={close}
          label={trade ? "Save changes" : "Record trade"}
          submit={async (fields) => {
            const row = parseTrade(
              Object.fromEntries(
                columns.map((key) => [key, value(fields, key)]),
              ),
              book.id,
              trade?.id,
            );
            await save((current) => ({
              ...current,
              trades: trade
                ? current.trades.map((item) =>
                    item.id === row.id ? row : item,
                  )
                : [...current.trades, row],
            }));
          }}
        >
          <div className="fields-grid">
            <Field label="Ticker">
              <Input
                name="symbol"
                required
                maxLength={20}
                placeholder="AAPL"
                defaultValue={trade?.symbol}
              />
            </Field>
            <Field label="Side">
              <select name="side" defaultValue={trade?.side ?? "buy"}>
                <option value="buy">Buy</option>
                <option value="sell">Sell</option>
              </select>
            </Field>
            <Field label="Trade date">
              <Input
                name="date"
                type="date"
                required
                defaultValue={trade?.date ?? today()}
              />
            </Field>
            <Field label="Shares">
              <Input
                name="quantity"
                type="number"
                min=".00000001"
                step="any"
                required
                defaultValue={trade?.quantity}
              />
            </Field>
            <Field label="Price per share">
              <Input
                name="price"
                type="number"
                min=".00000001"
                step="any"
                required
                defaultValue={trade?.price}
              />
            </Field>
            <Field label="Quote currency">
              <Input
                name="currency"
                required
                minLength={3}
                maxLength={3}
                defaultValue={trade?.currency ?? "USD"}
              />
            </Field>
            <Field label="Fees">
              <Input
                name="fees"
                type="number"
                min="0"
                step="any"
                defaultValue={trade?.fees ?? 0}
              />
            </Field>
          </div>
        </FormDialog>
      ) : null}
      {book && dialog === "import" ? (
        <FormDialog
          title="Import transactions"
          description={`Add transactions to ${book.name} from a CSV. Required columns are date (YYYY-MM-DD), symbol, side, quantity, price, and currency. Fees are optional.`}
          close={close}
          label="Import trades"
          submit={async (fields) => {
            const file = fields.get("file");
            if (!(file instanceof File) || !file.size || file.size > 1_000_000)
              throw new Error("Choose a CSV under 1 MB.");
            const parsed = Papa.parse<Record<string, string>>(
              await file.text(),
              {
                header: true,
                skipEmptyLines: "greedy",
                transformHeader: (header) => header.trim().toLowerCase(),
                transform: (cell) => cell.trim(),
              },
            );
            if (
              parsed.errors.length ||
              !parsed.data.length ||
              parsed.data.length > 5000
            )
              throw new Error(
                "The CSV must contain 1 to 5,000 valid data rows.",
              );
            const imported = parsed.data.map((entry, index) => {
              try {
                return parseTrade(entry, book.id);
              } catch (cause) {
                throw new Error(
                  `Row ${index + 2}. ${(cause as Error).message}`,
                );
              }
            });
            await save((current) => ({
              ...current,
              trades: [...current.trades, ...imported],
            }));
          }}
        >
          <Field label="Transaction CSV">
            <Input name="file" type="file" accept=".csv,text/csv" required />
          </Field>
          <Button
            type="button"
            variant="ghost"
            onClick={() =>
              downloadCsv(
                "stockwatcher-template.csv",
                `${columns.join(",")}\n${today()},AAPL,buy,2,150.00,USD,1.00\n`,
              )
            }
          >
            Download CSV template
          </Button>
        </FormDialog>
      ) : null}
      {dialog === "book" || (dialog === "rename" && book) ? (
        <FormDialog
          title={dialog === "rename" ? "Rename portfolio" : "New portfolio"}
          description="Name this portfolio so you can recognize it in the ledger."
          close={close}
          label={dialog === "rename" ? "Rename" : "Create portfolio"}
          submit={async (fields) => {
            const name = value(fields, "name");
            const id =
              dialog === "rename" && book ? book.id : crypto.randomUUID();
            await save((current) => ({
              ...current,
              books:
                dialog === "rename"
                  ? current.books.map((item) =>
                      item.id === id ? { ...item, name } : item,
                    )
                  : [...current.books, { id, name }],
            }));
            setSelected(id);
          }}
        >
          <Field label="Portfolio name">
            <Input
              name="name"
              defaultValue={dialog === "rename" ? book?.name : undefined}
              required
              maxLength={120}
            />
          </Field>
        </FormDialog>
      ) : null}
      {dialog === "remove-book" && book ? (
        <FormDialog
          title={`Delete ${book.name}?`}
          description={`This removes the portfolio and its ${trades.length} transactions.`}
          close={close}
          label="Delete portfolio"
          danger
          submit={() =>
            save((current) => ({
              ...current,
              books: current.books.filter((item) => item.id !== book.id),
              trades: current.trades.filter((item) => item.bookId !== book.id),
            }))
          }
        />
      ) : null}
      {dialog === "remove-trade" && trade ? (
        <RemoveDialog
          item={`the ${trade.symbol} transaction`}
          close={close}
          remove={() =>
            save((current) => ({
              ...current,
              trades: current.trades.filter((item) => item.id !== trade.id),
            }))
          }
        />
      ) : null}
    </>
  );
}
