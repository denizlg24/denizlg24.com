"use client";

import { useMemo, useState } from "react";
import useSWR from "swr";
import {
  ArrowDownToLine,
  ArrowRight,
  BookOpen,
  FileText,
  MessagesSquare,
  Newspaper,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import Papa from "papaparse";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Field, FormDialog, RemoveDialog, value, type Save } from "./forms";
import {
  api,
  Change,
  Empty,
  Failure,
  Loading,
  PanelHeading,
  SectionFoot,
  signed,
  SourceLink,
  SymbolLink,
  Tick,
} from "./shared";
import { NewsPanel, useQuotes } from "./market-widgets";
import { amount, compact, marketTime, number, tone } from "@/lib/utils";
import { symbolSchema, type Workspace } from "@/lib/models";
import {
  managers,
  type CompanyResearch,
  type HoldingsReport,
  type Mention,
} from "@/lib/research-types";

export type ResearchTab = "company" | "filings" | "social" | "journal";

function Company({
  ticker,
  refresh,
  onSearch,
  onChart,
}: {
  ticker: string;
  refresh: boolean;
  onSearch: () => void;
  onChart: () => void;
}) {
  const {
    data: result,
    error,
    mutate,
    isLoading,
  } = useSWR<CompanyResearch>(
    `/api/research?symbol=${encodeURIComponent(ticker)}`,
    api,
    { errorRetryCount: 1 },
  );
  const { data: quotes } = useQuotes([ticker], refresh);
  const quote = quotes?.quotes[0];
  const isIndex = ticker.startsWith("^");
  const unit = isIndex ? "pts" : quote?.currency;
  return (
    <div className="research-grid">
      <section className="panel">
        <PanelHeading
          title={quote?.name ?? result?.company ?? ticker}
          subtitle={`${ticker}${quote?.exchange ? ` · ${quote.exchange}` : ""}`}
        >
          <div className="row-actions">
            <Button variant="outline" size="sm" onClick={onSearch}>
              Find company
            </Button>
            <Button variant="ghost" size="sm" onClick={onChart}>
              Chart <ArrowRight />
            </Button>
          </div>
        </PanelHeading>
        <div className="research-quote">
          <strong>
            <Tick value={quote?.price} />
          </strong>
          <small>{unit}</small>
          <span className={`price-delta ${tone(quote?.change)}`}>
            {signed(quote?.change)}
          </span>
          <Change value={quote?.percent} arrows />
        </div>
        <dl className="stats-grid">
          {[
            ["Previous close", amount(quote?.previous)],
            ["Session high", amount(quote?.high)],
            ["Session low", amount(quote?.low)],
            ["Volume", compact(quote?.volume)],
            ["52-week high", amount(quote?.yearHigh)],
            ["52-week low", amount(quote?.yearLow)],
          ].map(([label, result]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{result}</dd>
            </div>
          ))}
        </dl>
        <SectionFoot>
          <span>
            Yahoo Finance{quote ? ` · ${marketTime(quote.time)}` : ""}
          </span>
          {unit ? <span>{unit}</span> : null}
        </SectionFoot>
        <div className="subsection-gap" />
        <PanelHeading
          title="Annual financials"
          subtitle="Reported fiscal periods · SEC EDGAR"
        >
          {result ? (
            <SourceLink href={result.url}>SEC issuer page</SourceLink>
          ) : null}
        </PanelHeading>
        <Failure error={error} retry={mutate} />
        {isLoading ? (
          <Loading message="Loading filings and financials" />
        ) : result?.facts.length ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Metric</TableHead>
                <TableHead className="text-right">Value</TableHead>
                <TableHead>Period ended</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {result.facts.map((fact) => (
                <TableRow key={fact.label}>
                  <TableCell>{fact.label}</TableCell>
                  <TableCell className="text-right strong-cell">
                    {fact.unit === "USD/shares"
                      ? amount(fact.value)
                      : compact(fact.value)}{" "}
                    {fact.unit === "USD/shares" ? "USD/share" : fact.unit}
                  </TableCell>
                  <TableCell className="muted">{fact.period}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : !error ? (
          <Empty
            title={
              isIndex
                ? "Indexes have no reported financials"
                : "No annual US GAAP figures"
            }
          >
            {isIndex
              ? "Search for a company to see its SEC filings and reported figures."
              : "For international listings, check recent filings and the company’s investor relations page."}
          </Empty>
        ) : null}
        {result?.filings.length ? (
          <div className="filing-block">
            <h3>Recent SEC filings</h3>
            <div className="filing-list">
              {result.filings.map((filing, index) => (
                <div key={`${filing.url}:${index}`}>
                  <SourceLink href={filing.url}>{filing.form}</SourceLink>
                  <span>Filed {filing.filed}</span>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </section>
      <NewsPanel ticker={ticker} limit={10} />
    </div>
  );
}

function exportHoldings(report: HoldingsReport) {
  const blob = new Blob(
    [Papa.unparse(report.holdings, { escapeFormulae: true })],
    { type: "text/csv;charset=utf-8" },
  );
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `stockwatcher-13f-${report.period}.csv`;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

function Filings({
  cik,
  setCik,
}: {
  cik: string;
  setCik: (cik: string) => void;
}) {
  const [input, setInput] = useState("");
  const [filter, setFilter] = useState("");
  const [limit, setLimit] = useState(40);
  const { data, error, mutate, isLoading } = useSWR<HoldingsReport>(
    cik ? `/api/research?cik=${encodeURIComponent(cik)}` : null,
    api,
    { errorRetryCount: 0 },
  );
  const rows = useMemo(() => {
    const merged = new Map<string, HoldingsReport["holdings"][number]>();
    for (const entry of data?.holdings ?? []) {
      const key = `${entry.cusip}|${entry.name}|${entry.putCall}|${entry.type}`;
      const existing = merged.get(key);
      merged.set(
        key,
        existing
          ? {
              ...entry,
              shares: existing.shares + entry.shares,
              value: existing.value + entry.value,
            }
          : entry,
      );
    }
    const needle = filter.toUpperCase();
    return [...merged.values()]
      .filter((item) => (item.name + item.cusip).toUpperCase().includes(needle))
      .sort((a, b) => b.value - a.value);
  }, [data, filter]);
  const total =
    data?.holdings.reduce((sum, entry) => sum + entry.value, 0) ?? 0;
  return (
    <section className="panel">
      <PanelHeading
        title="Institutional holdings"
        subtitle="Latest Form 13F on SEC EDGAR. Holdings reflect the report date."
      />
      <div className="controls-inset">
        <select
          aria-label="Investment manager"
          value={Object.values(managers).includes(cik as never) ? cik : ""}
          onChange={(event) => {
            setLimit(40);
            setCik(event.target.value);
          }}
        >
          <option value="">Choose a manager</option>
          {Object.entries(managers).map(([name, value]) => (
            <option key={value} value={value}>
              {name}
            </option>
          ))}
        </select>
        <form
          className="row-actions"
          onSubmit={(event) => {
            event.preventDefault();
            setLimit(40);
            setCik(input.trim());
          }}
        >
          <Input
            value={input}
            onChange={(event) => setInput(event.target.value)}
            aria-label="SEC CIK"
            placeholder="SEC CIK"
            inputMode="numeric"
            pattern="[0-9]{1,10}"
            required
          />
          <Button type="submit" size="sm" variant="outline">
            Look up
          </Button>
        </form>
      </div>
      <Failure error={error} retry={mutate} />
      {isLoading ? (
        <Loading message="Loading SEC holdings" />
      ) : data ? (
        <>
          <PanelHeading
            title={data.manager}
            subtitle={`Period ended ${data.period} · filed ${data.filed}`}
          >
            <div className="row-actions">
              <SourceLink href={data.url}>
                {data.amended ? "Latest amendment" : "Original filing"}
              </SourceLink>
              <Button
                size="sm"
                variant="outline"
                onClick={() => exportHoldings(data)}
              >
                <ArrowDownToLine /> CSV
              </Button>
            </div>
          </PanelHeading>
          <div className="controls-inset">
            <Input
              placeholder="Filter holdings"
              aria-label="Filter holdings"
              value={filter}
              onChange={(event) => {
                setFilter(event.target.value);
                setLimit(40);
              }}
            />
            <span className="muted">
              {rows.length} positions · {compact(total)} USD reported
            </span>
          </div>
          {rows.length ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Issuer</TableHead>
                  <TableHead>CUSIP</TableHead>
                  <TableHead>Class</TableHead>
                  <TableHead className="text-right">Reported units</TableHead>
                  <TableHead className="text-right">Value (USD)</TableHead>
                  <TableHead className="text-right">Weight</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.slice(0, limit).map((item) => (
                  <TableRow
                    key={`${item.cusip}:${item.name}:${item.type}:${item.putCall}`}
                  >
                    <TableCell className="truncate-cell">{item.name}</TableCell>
                    <TableCell className="muted">{item.cusip}</TableCell>
                    <TableCell className="muted">
                      {item.type}
                      {item.putCall ? ` · ${item.putCall}` : ""}
                    </TableCell>
                    <TableCell className="text-right">
                      {number(item.shares)}
                    </TableCell>
                    <TableCell className="text-right strong-cell">
                      {number(item.value)}
                    </TableCell>
                    <TableCell className="text-right">
                      {total ? `${amount((item.value / total) * 100)}%` : "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <Empty title="No matching holdings">
              Clear the filter to see the entire report.
            </Empty>
          )}
          {rows.length > limit ? (
            <div className="panel-foot">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setLimit(limit + 60)}
              >
                Show more holdings
              </Button>
            </div>
          ) : null}
        </>
      ) : !error ? (
        <Empty title="Choose a filing manager">
          You can also enter an SEC Central Index Key.
        </Empty>
      ) : null}
    </section>
  );
}

function Social({ select }: { select: (ticker: string) => void }) {
  const { data, error, mutate, isLoading } = useSWR<Mention[]>(
    "/api/research?view=social",
    api,
    { errorRetryCount: 1 },
  );
  return (
    <section className="panel">
      <PanelHeading
        title="WallStreetBets mentions"
        subtitle="Most discussed tickers over the last 24 hours"
      >
        <SourceLink href="https://apewisdom.io/wallstreetbets/">
          ApeWisdom
        </SourceLink>
      </PanelHeading>
      <Failure error={error} retry={mutate} />
      {isLoading ? (
        <Loading message="Loading mention counts" />
      ) : data?.length ? (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Rank</TableHead>
              <TableHead>Symbol</TableHead>
              <TableHead>Company</TableHead>
              <TableHead className="text-right">Mentions</TableHead>
              <TableHead className="text-right">Prior 24h</TableHead>
              <TableHead className="text-right">Difference</TableHead>
              <TableHead className="text-right">Upvotes</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.map((item) => (
              <TableRow key={`${item.rank}:${item.symbol}`}>
                <TableCell className="muted">{item.rank}</TableCell>
                <TableCell>
                  <SymbolLink
                    symbol={item.symbol}
                    select={select}
                    label={item.name}
                  />
                </TableCell>
                <TableCell className="truncate-cell">{item.name}</TableCell>
                <TableCell className="text-right strong-cell">
                  {number(item.count)}
                </TableCell>
                <TableCell className="text-right muted">
                  {number(item.prior)}
                </TableCell>
                <TableCell
                  className={`text-right ${tone(item.count - item.prior)}`}
                >
                  {item.count > item.prior ? "+" : ""}
                  {number(item.count - item.prior)}
                </TableCell>
                <TableCell className="text-right muted">
                  {number(item.upvotes)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : !error ? (
        <Empty title="No mention data returned" />
      ) : null}
    </section>
  );
}

function Journal({
  notes,
  save,
  ticker,
  select,
}: {
  notes: Workspace["notes"];
  save: Save;
  ticker: string;
  select: (ticker: string) => void;
}) {
  const [modal, setModal] = useState<"new" | "edit" | "delete" | null>(null);
  const [selected, setSelected] = useState<Workspace["notes"][number]>();
  const [filter, setFilter] = useState("");
  const needle = filter.trim().toLowerCase();
  const rows = notes
    .filter(({ title, body, symbol }) =>
      `${title} ${body} ${symbol}`.toLowerCase().includes(needle),
    )
    .toSorted((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return (
    <section className="panel">
      <PanelHeading
        title="Research journal"
        subtitle="Keep notes and links with your account."
      >
        <Button
          size="sm"
          onClick={() => {
            setSelected(undefined);
            setModal("new");
          }}
        >
          <Plus /> New note
        </Button>
      </PanelHeading>
      <div className="controls-inset">
        <Input
          placeholder="Search notes"
          aria-label="Search notes"
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
        />
      </div>
      {rows.length ? (
        <div className="note-grid">
          {rows.map((note) => (
            <article key={note.id} className="note">
              <div className="note-top">
                <h3>{note.title}</h3>
                <div className="row-actions">
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label={`Edit ${note.title}`}
                    onClick={() => {
                      setSelected(note);
                      setModal("edit");
                    }}
                  >
                    <Pencil />
                  </Button>
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label={`Delete ${note.title}`}
                    onClick={() => {
                      setSelected(note);
                      setModal("delete");
                    }}
                  >
                    <Trash2 />
                  </Button>
                </div>
              </div>
              <p>{note.body}</p>
              <div className="note-meta">
                {note.symbol ? (
                  <SymbolLink symbol={note.symbol} select={select} />
                ) : (
                  <span />
                )}
                <span>{marketTime(Date.parse(note.updatedAt) / 1000)}</span>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <Empty
          title={
            notes.length ? "No matching notes" : "Start your research journal"
          }
        >
          {notes.length
            ? "Try another search."
            : "Capture your thesis, questions, and source links as you work."}
        </Empty>
      )}
      {modal === "new" || modal === "edit" ? (
        <FormDialog
          title={selected ? "Edit research note" : "New research note"}
          description="The ticker is optional. You can paste source URLs in the note."
          close={() => setModal(null)}
          submit={async (fields) => {
            const symbol = value(fields, "symbol");
            const note = {
              id: selected?.id ?? crypto.randomUUID(),
              title: value(fields, "title"),
              symbol: symbol ? symbolSchema.parse(symbol) : "",
              body: value(fields, "body"),
              updatedAt: new Date().toISOString(),
            };
            await save((workspace) => ({
              ...workspace,
              notes: selected
                ? workspace.notes.map((item) =>
                    item.id === selected.id ? note : item,
                  )
                : [note, ...workspace.notes],
            }));
          }}
        >
          <Field label="Title">
            <Input
              name="title"
              maxLength={120}
              defaultValue={selected?.title}
              required
            />
          </Field>
          <Field label="Ticker">
            <Input
              name="symbol"
              maxLength={20}
              defaultValue={selected?.symbol ?? ticker}
            />
          </Field>
          <Field label="Note">
            <Textarea
              rows={7}
              name="body"
              maxLength={40000}
              defaultValue={selected?.body}
              required
            />
          </Field>
        </FormDialog>
      ) : null}
      {modal === "delete" && selected ? (
        <RemoveDialog
          item={selected.title}
          close={() => setModal(null)}
          remove={() =>
            save((workspace) => ({
              ...workspace,
              notes: workspace.notes.filter((item) => item.id !== selected.id),
            }))
          }
        />
      ) : null}
    </section>
  );
}

export function Research({
  tab,
  setTab,
  ticker,
  refresh,
  notes,
  save,
  cik,
  setCik,
  select,
  onSearch,
  onChart,
}: {
  tab: ResearchTab;
  setTab: (tab: ResearchTab) => void;
  ticker: string;
  refresh: boolean;
  notes: Workspace["notes"];
  save: Save;
  cik: string;
  setCik: (cik: string) => void;
  select: (symbol: string) => void;
  onSearch: () => void;
  onChart: () => void;
}) {
  return (
    <Tabs
      value={tab}
      onValueChange={(view) => setTab(view as ResearchTab)}
      className="workspace-tabs"
    >
      <TabsList variant="line">
        <TabsTrigger value="company">
          <Newspaper /> Company research
        </TabsTrigger>
        <TabsTrigger value="filings">
          <FileText /> 13F holdings
        </TabsTrigger>
        <TabsTrigger value="social">
          <MessagesSquare /> WallStreetBets
        </TabsTrigger>
        <TabsTrigger value="journal">
          <BookOpen /> Journal
        </TabsTrigger>
      </TabsList>
      <TabsContent value="company">
        <Company
          ticker={ticker}
          refresh={refresh}
          onSearch={onSearch}
          onChart={onChart}
        />
      </TabsContent>
      <TabsContent value="filings">
        <Filings cik={cik} setCik={setCik} />
      </TabsContent>
      <TabsContent value="social">
        <Social select={select} />
      </TabsContent>
      <TabsContent value="journal">
        <Journal notes={notes} ticker={ticker} save={save} select={select} />
      </TabsContent>
    </Tabs>
  );
}
