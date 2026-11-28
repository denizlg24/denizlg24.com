"use client";

import { ExternalLink } from "lucide-react";
import { type FormEvent, type ReactNode, useState } from "react";
import useSWR from "swr";
import {
  api,
  Change,
  Empty,
  Failure,
  Loading,
  SymbolLink,
} from "@/components/shared";
import type {
  ChangeStatus,
  EtfHoldings as EtfHoldingsData,
  ExecComp as ExecCompData,
  InstitutionalHolders as HoldersData,
  ManagerChanges,
  ManagerHit,
  ManagerHoldings,
} from "@/lib/alt/sec/types";
import type { AltResult } from "@/lib/alt/types";
import { compact } from "@/lib/utils";

function useAlt<T>(dataset: string, params: Record<string, string> | null) {
  const { data, error, isLoading, mutate } = useSWR<AltResult<T>>(
    params ? `/api/alt?${new URLSearchParams({ dataset, ...params })}` : null,
    api,
    { revalidateOnFocus: false, errorRetryCount: 1, keepPreviousData: true },
  );
  return { data, error, isLoading, retry: () => void mutate() };
}

const dateFormat = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
});
const dateLabel = (iso: string | null | undefined) => {
  if (!iso) return "—";
  const date = new Date(iso.length === 10 ? `${iso}T12:00:00Z` : iso);
  return Number.isNaN(date.getTime()) ? "—" : dateFormat.format(date);
};
const usd = (value: number | null | undefined) =>
  value == null ? "—" : `$${compact(value)}`;
const count = (value: number | null | undefined) =>
  value == null ? "—" : compact(value);
const pct = (value: number | null | undefined, digits = 2) =>
  value == null ? "—" : `${value.toFixed(digits)}%`;

function Provenance<T>({
  result,
  detail,
}: {
  result: AltResult<T>;
  detail?: ReactNode;
}) {
  return (
    <span className="term-source">
      {result.source}
      {result.asOf ? ` · as of ${dateLabel(result.asOf)}` : ""}
      {` · fetched ${new Date(result.fetchedAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`}
      {result.stale ? " · stale, refresh failed" : ""}
      {detail ? <> · {detail}</> : null}
    </span>
  );
}

function Gate<T>({
  state,
  children,
}: {
  state: ReturnType<typeof useAlt<T>>;
  children: (result: AltResult<T>) => ReactNode;
}) {
  if (state.error && !state.data)
    return <Failure error={state.error} retry={state.retry} />;
  if (!state.data) return <Loading message="Loading" />;
  return <>{children(state.data)}</>;
}

function Outbound({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noreferrer">
      {children}
      <ExternalLink size={11} aria-hidden />
    </a>
  );
}

const statusLabel: Record<ChangeStatus, string> = {
  new: "New",
  added: "Added",
  reduced: "Reduced",
  sold: "Sold out",
  unchanged: "Unchanged",
};
const statusTone = (status: ChangeStatus | null) =>
  status === "new" || status === "added"
    ? "positive"
    : status === "reduced" || status === "sold"
      ? "negative"
      : "muted";

function ManagerHoldingsTable({ cik }: { cik: string }) {
  const state = useAlt<ManagerHoldings>("13f.manager", { cik });
  return (
    <Gate state={state}>
      {(result) => {
        const { data } = result;
        return (
          <section className="term-block term-wide">
            <h3>
              {data.manager.name} · {dateLabel(data.period)}
            </h3>
            <p className="term-source">
              {data.positionCount} positions · {usd(data.totalValue)} reported ·
              filed {dateLabel(data.filed)}
              {data.restated ? " · restated by amendment" : ""}
            </p>
            {data.positions.length ? (
              <div className="desk-table-wrap">
                <table className="data-table alt-table">
                  <thead>
                    <tr>
                      <th>Issuer</th>
                      <th>Class</th>
                      <th>CUSIP</th>
                      <th className="num">Shares</th>
                      <th className="num">Value</th>
                      <th className="num">% port.</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.positions.map((position) => (
                      <tr
                        key={`${position.cusip}-${position.putCall}-${position.shareType}`}
                      >
                        <td>
                          {position.issuer}
                          {position.putCall ? (
                            <span className="muted"> · {position.putCall}</span>
                          ) : null}
                        </td>
                        <td className="muted">{position.titleOfClass}</td>
                        <td className="muted">{position.cusip}</td>
                        <td className="num">
                          {count(position.shares)}
                          {position.shareType === "PRN" ? " prn" : ""}
                        </td>
                        <td className="num">{usd(position.value)}</td>
                        <td className="num">
                          {data.totalValue > 0
                            ? pct((position.value / data.totalValue) * 100)
                            : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <Empty title="No information table in this filing" />
            )}
            <Provenance
              result={result}
              detail={
                data.truncated
                  ? `top ${data.positions.length} of ${data.positionCount}`
                  : undefined
              }
            />
          </section>
        );
      }}
    </Gate>
  );
}

function ManagerChangesTable({ cik }: { cik: string }) {
  const state = useAlt<ManagerChanges>("13f.changes", { cik });
  return (
    <Gate state={state}>
      {(result) => {
        const { data } = result;
        return (
          <section className="term-block term-wide">
            <h3>
              {data.manager.name} · {dateLabel(data.previous?.period)} →{" "}
              {dateLabel(data.current.period)}
            </h3>
            <p className="term-source">
              {data.counts.new} new · {data.counts.added} added ·{" "}
              {data.counts.reduced} reduced · {data.counts.sold} sold out ·{" "}
              {data.counts.unchanged} unchanged
            </p>
            {data.changes.length ? (
              <div className="desk-table-wrap">
                <table className="data-table alt-table">
                  <thead>
                    <tr>
                      <th>Issuer</th>
                      <th>Move</th>
                      <th className="num">Shares</th>
                      <th className="num">Before</th>
                      <th className="num">Chg</th>
                      <th className="num">Value</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.changes.map((change) => (
                      <tr
                        key={`${change.cusip}-${change.putCall}-${change.status}`}
                      >
                        <td>
                          {change.issuer}
                          {change.putCall ? (
                            <span className="muted"> · {change.putCall}</span>
                          ) : null}
                        </td>
                        <td className={statusTone(change.status)}>
                          {statusLabel[change.status]}
                        </td>
                        <td className="num">{count(change.shares)}</td>
                        <td className="num muted">
                          {count(change.previousShares)}
                        </td>
                        <td className="num">
                          <Change value={change.sharesChangePercent} />
                        </td>
                        <td className="num">
                          {usd(change.value || change.previousValue)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <Empty title="No changes" />
            )}
            <Provenance
              result={result}
              detail={
                data.previous ? undefined : "no earlier report to compare with"
              }
            />
          </section>
        );
      }}
    </Gate>
  );
}

export function ManagerPortfolio() {
  const [text, setText] = useState("");
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<ManagerHit | null>(null);
  const [tab, setTab] = useState<"holdings" | "changes">("holdings");
  const search = useAlt<{ managers: ManagerHit[] }>(
    "13f.search",
    query ? { q: query } : null,
  );
  const managers = search.data?.data.managers ?? [];
  const active = picked ?? (managers.length === 1 ? managers[0] : null);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (text.trim().length < 2) return;
    setPicked(null);
    setQuery(text.trim());
  };

  return (
    <div className="term-stack">
      <div className="term-toolbar">
        <form className="row-actions" onSubmit={submit}>
          <input
            className="studio-select"
            placeholder="Manager name or CIK"
            value={text}
            maxLength={80}
            onChange={(event) => setText(event.target.value)}
            aria-label="Search 13F managers"
          />
          <button type="submit" className="chip">
            Search
          </button>
        </form>
        {active ? (
          <div className="seg" role="group" aria-label="13F view">
            <button
              type="button"
              aria-pressed={tab === "holdings"}
              onClick={() => setTab("holdings")}
            >
              Holdings
            </button>
            <button
              type="button"
              aria-pressed={tab === "changes"}
              onClick={() => setTab("changes")}
            >
              Changes
            </button>
          </div>
        ) : null}
      </div>
      {query && !search.data && !search.error ? (
        <Loading message="Searching" />
      ) : null}
      {search.error && !search.data ? (
        <Failure error={search.error} retry={search.retry} />
      ) : null}
      {search.data && !active ? (
        managers.length ? (
          <section className="term-block term-wide">
            <h3>Managers</h3>
            <div className="desk-table-wrap">
              <table className="data-table alt-table">
                <tbody>
                  {managers.map((manager) => (
                    <tr key={manager.cik}>
                      <td>
                        <button
                          type="button"
                          className="sym-link"
                          onClick={() => setPicked(manager)}
                        >
                          {manager.name}
                        </button>
                      </td>
                      <td className="muted">{manager.state ?? ""}</td>
                      <td className="num muted">{manager.cik}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ) : (
          <Empty title="No 13F filer matches" />
        )
      ) : null}
      {active ? (
        tab === "holdings" ? (
          <ManagerHoldingsTable cik={active.cik} />
        ) : (
          <ManagerChangesTable cik={active.cik} />
        )
      ) : null}
    </div>
  );
}

export function InstitutionalHolders({
  ticker,
}: {
  ticker: string;
  select?: (symbol: string) => void;
}) {
  const state = useAlt<HoldersData>("13f.holders", { symbol: ticker });
  return (
    <Gate state={state}>
      {(result) => {
        const { data } = result;
        const { coverage } = data;
        return (
          <section className="term-block term-wide">
            <h3>
              Institutional holders · {data.name} · {dateLabel(data.period)}
            </h3>
            <p className="term-source">
              {coverage.filersWithPosition} of {coverage.filersChecked} largest
              filers hold it
              {coverage.filersTotal != null
                ? ` · ${coverage.filersTotal.toLocaleString("en-GB")} filers reported CUSIP ${data.cusip} this window`
                : ""}
              {coverage.pending
                ? ` · ${coverage.pending} still loading, refresh shortly`
                : ""}
            </p>
            {data.holders.length ? (
              <div className="desk-table-wrap">
                <table className="data-table alt-table">
                  <thead>
                    <tr>
                      <th>Holder</th>
                      <th className="num">Shares</th>
                      <th className="num">Value</th>
                      <th className="num">% port.</th>
                      <th className="num">Chg</th>
                      <th>Move</th>
                      <th className="num">Period</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.holders.map((holder) => (
                      <tr key={holder.cik}>
                        <td>
                          <Outbound
                            href={`https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${holder.cik}&type=13F-HR`}
                          >
                            {holder.name}
                          </Outbound>
                        </td>
                        <td className="num">{count(holder.shares)}</td>
                        <td className="num">{usd(holder.value)}</td>
                        <td className="num">{pct(holder.portfolioPercent)}</td>
                        <td className="num">
                          <Change value={holder.sharesChangePercent} />
                        </td>
                        <td className={statusTone(holder.status)}>
                          {holder.status ? statusLabel[holder.status] : "—"}
                        </td>
                        <td
                          className={`num ${holder.lagging ? "negative" : "muted"}`}
                          title={
                            holder.lagging
                              ? "Has not yet filed for the latest quarter"
                              : undefined
                          }
                        >
                          {dateLabel(holder.period)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <Empty title="No filings reported" />
            )}
            <Provenance result={result} detail={coverage.rankedBy} />
          </section>
        );
      }}
    </Gate>
  );
}

const payColumns = [
  ["salary", "Salary"],
  ["bonus", "Bonus"],
  ["stockAwards", "Stock"],
  ["optionAwards", "Options"],
  ["nonEquityIncentive", "Non-equity"],
  ["other", "Other"],
  ["total", "Total"],
] as const;

export function ExecComp({ ticker }: { ticker: string }) {
  const state = useAlt<ExecCompData>("comp.exec", { symbol: ticker });
  return (
    <Gate state={state}>
      {(result) => {
        const { data } = result;
        const table = data.summaryTable;
        return (
          <div className="term-grid">
            <section className="term-block term-wide">
              <h3>Summary compensation · {data.company}</h3>
              <p className="term-source">
                {data.proxy ? (
                  <Outbound href={data.proxy.url}>
                    DEF 14A filed {dateLabel(data.proxy.filed)}
                  </Outbound>
                ) : (
                  "No proxy statement"
                )}
                {table.parsed ? " · parsed from the proxy HTML" : ""}
                {table.note ? ` · ${table.note}` : ""}
              </p>
              {table.rows.length ? (
                <div className="desk-table-wrap">
                  <table className="data-table alt-table">
                    <thead>
                      <tr>
                        <th>Executive</th>
                        <th className="num">Year</th>
                        {payColumns.map(([key, label]) => (
                          <th key={key} className="num">
                            {label}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {table.rows.map((row) => (
                        <tr key={`${row.name}-${row.year}-${row.total}`}>
                          <td>
                            {row.name}
                            {row.title ? (
                              <span className="muted"> · {row.title}</span>
                            ) : null}
                          </td>
                          <td className="num">{row.year}</td>
                          {payColumns.map(([key]) => (
                            <td key={key} className="num">
                              {usd(row[key])}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <Empty title="Table not readable" />
              )}
            </section>
            {data.payVersusPerformance.length ? (
              <section className="term-block term-wide">
                <h3>Pay versus performance</h3>
                <div className="desk-table-wrap">
                  <table className="data-table alt-table">
                    <thead>
                      <tr>
                        <th>Fiscal year end</th>
                        <th className="num">CEO total</th>
                        <th className="num">CEO actually paid</th>
                        <th className="num">Other NEO avg</th>
                        <th className="num">Other NEO paid</th>
                        <th className="num">TSR</th>
                        <th className="num">Peer TSR</th>
                        <th className="num">Net income</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.payVersusPerformance.map((row) => (
                        <tr key={row.fiscalYearEnd}>
                          <td>{dateLabel(row.fiscalYearEnd)}</td>
                          <td className="num">{usd(row.peoTotal)}</td>
                          <td className="num">{usd(row.peoActuallyPaid)}</td>
                          <td className="num">{usd(row.neoAverageTotal)}</td>
                          <td className="num">
                            {usd(row.neoAverageActuallyPaid)}
                          </td>
                          <td className="num">
                            {row.totalShareholderReturn ?? "—"}
                          </td>
                          <td className="num">
                            {row.peerTotalShareholderReturn ?? "—"}
                          </td>
                          <td className="num">{usd(row.netIncome)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            ) : null}
            <Provenance result={result} />
          </div>
        );
      }}
    </Gate>
  );
}

export function EtfHoldings({
  ticker,
  select,
}: {
  ticker: string;
  select?: (symbol: string) => void;
}) {
  const state = useAlt<EtfHoldingsData>("etf.holdings", { symbol: ticker });
  return (
    <Gate state={state}>
      {(result) => {
        const { data } = result;
        return (
          <section className="term-block term-wide">
            <h3>
              {data.series ?? data.fund} · {dateLabel(data.reportDate)}
            </h3>
            <p className="term-source">
              {data.holdingCount.toLocaleString("en-GB")} holdings · top{" "}
              {data.holdings.length} = {pct(data.topPercent, 1)} of net assets
              {data.netAssets != null
                ? ` · ${usd(data.netAssets)} net assets`
                : ""}
              {" · filed "}
              {dateLabel(data.filed)}
              {" (N-PORT is public about 60 days after the period end)"}
            </p>
            {data.holdings.length ? (
              <div className="desk-table-wrap">
                <table className="data-table alt-table">
                  <thead>
                    <tr>
                      <th>Holding</th>
                      <th>Ticker</th>
                      <th>ID</th>
                      <th className="num">Shares</th>
                      <th className="num">Value</th>
                      <th className="num">% NAV</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.holdings.map((holding, index) => (
                      <tr
                        key={`${holding.cusip ?? holding.isin ?? holding.name}-${index}`}
                      >
                        <td>{holding.name}</td>
                        <td>
                          {holding.ticker && select ? (
                            <SymbolLink
                              symbol={holding.ticker}
                              select={select}
                            />
                          ) : (
                            (holding.ticker ?? "—")
                          )}
                        </td>
                        <td className="muted">
                          {holding.cusip ?? holding.isin ?? "—"}
                        </td>
                        <td className="num">
                          {count(holding.shares)}
                          {holding.units && holding.units !== "NS"
                            ? ` ${holding.units.toLowerCase()}`
                            : ""}
                        </td>
                        <td className="num">{usd(holding.value)}</td>
                        <td className="num">
                          {pct(holding.percentOfNetAssets, 3)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <Empty title="No holdings reported" />
            )}
            <Provenance result={result} />
          </section>
        );
      }}
    </Gate>
  );
}
