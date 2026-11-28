"use client";

import { ExternalLink } from "lucide-react";
import { type ReactNode, useState } from "react";
import useSWR from "swr";
import { api, Empty, Failure, Loading, SymbolLink } from "@/components/shared";
import type {
  ContractsRecent,
  ContractsTicker,
  LobbyingFeed as LobbyingFeedData,
  LobbyingTicker,
  PacTicker,
  PacTop,
  RevolvingLobbyist,
} from "@/lib/alt/gov/types";
import type { AltResult } from "@/lib/alt/types";
import { compact } from "@/lib/utils";

const MINUTE = 60_000;

function useAlt<T>(
  dataset: string,
  params: Record<string, string | number> = {},
  refreshMs = 0,
) {
  const query = new URLSearchParams({
    dataset,
    ...Object.fromEntries(
      Object.entries(params).map(([k, v]) => [k, String(v)]),
    ),
  });
  const { data, error, isLoading, mutate } = useSWR<AltResult<T>>(
    `/api/alt?${query}`,
    api,
    {
      refreshInterval: refreshMs,
      revalidateOnFocus: false,
      errorRetryCount: 1,
      keepPreviousData: true,
    },
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

function Link({
  href,
  children,
}: {
  href: string | null;
  children: ReactNode;
}) {
  if (!href) return <>{children}</>;
  return (
    <a href={href} target="_blank" rel="noreferrer">
      {children}
      <ExternalLink size={11} aria-hidden />
    </a>
  );
}

function Names({ label, names }: { label: string; names: string[] }) {
  if (!names.length) return null;
  return (
    <p className="term-source">
      {label}: {names.join(" · ")}
    </p>
  );
}

function Revolving({
  rows,
  select,
}: {
  rows: RevolvingLobbyist[];
  select?: (symbol: string) => void;
}) {
  if (!rows.length)
    return <Empty title="No lobbyists with a prior government role" />;
  return (
    <div className="desk-table-wrap">
      <table className="data-table alt-table">
        <thead>
          <tr>
            <th>Lobbyist</th>
            <th>Prior position</th>
            <th>Clients</th>
            <th>Firm</th>
            <th className="num">Filings</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.name}>
              <td>{row.name}</td>
              <td className="muted">{row.covered}</td>
              <td>
                {row.clients.slice(0, 4).map((client, index) => (
                  <span key={client.client}>
                    {index ? " · " : ""}
                    {client.ticker && select ? (
                      <SymbolLink
                        symbol={client.ticker}
                        select={select}
                        label={client.client}
                      />
                    ) : (
                      client.client
                    )}
                  </span>
                ))}
                {row.clients.length > 4 ? ` +${row.clients.length - 4}` : ""}
              </td>
              <td className="muted">
                {row.registrants.slice(0, 2).join(" · ")}
              </td>
              <td className="num">{row.filings}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ActionTable({
  rows,
  select,
}: {
  rows: ContractsRecent["actions"];
  select?: (symbol: string) => void;
}) {
  if (!rows.length) return <Empty title="No contract actions" />;
  return (
    <div className="desk-table-wrap">
      <table className="data-table alt-table">
        <thead>
          <tr>
            <th>Date</th>
            {select ? <th>Ticker</th> : null}
            <th>Recipient</th>
            <th>Agency</th>
            <th>Description</th>
            <th className="num">Amount</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={`${row.awardId}-${row.date}-${index}`}>
              <td>{dateLabel(row.date)}</td>
              {select ? (
                <td>
                  {row.ticker ? (
                    <SymbolLink
                      symbol={row.ticker}
                      select={select}
                      label={row.recipient}
                    />
                  ) : (
                    "—"
                  )}
                </td>
              ) : null}
              <td>{row.recipient}</td>
              <td className="muted">{row.subAgency ?? row.agency ?? "—"}</td>
              <td className="muted" title={row.description ?? undefined}>
                <Link href={row.url}>
                  {(row.description ?? row.awardId).slice(0, 90)}
                </Link>
              </td>
              <td className="num">{usd(row.amount)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function ContractsFeed({
  select,
}: {
  select: (symbol: string) => void;
}) {
  const [days, setDays] = useState(7);
  const state = useAlt<ContractsRecent>(
    "contracts.recent",
    { days, minAmount: 1_000_000 },
    10 * MINUTE,
  );
  return (
    <div className="term-stack">
      <div className="term-toolbar">
        <div className="seg" role="group" aria-label="Window">
          {[1, 7, 30].map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={days === value}
              onClick={() => setDays(value)}
            >
              {value}d
            </button>
          ))}
        </div>
        {state.data ? (
          <Provenance
            result={state.data}
            detail={`${state.data.data.actions.length} of the ${state.data.data.scanned} largest actions resolve to a listed company`}
          />
        ) : null}
      </div>
      <Gate state={state}>
        {(result) => <ActionTable rows={result.data.actions} select={select} />}
      </Gate>
    </div>
  );
}

export function ContractsView({ ticker }: { ticker: string }) {
  const state = useAlt<ContractsTicker>("contracts.ticker", { symbol: ticker });
  return (
    <Gate state={state}>
      {(result) => (
        <div className="term-stack">
          <div className="term-toolbar">
            <Provenance
              result={result}
              detail={
                result.data.dropped
                  ? `${result.data.dropped} actions to other recipients dropped`
                  : undefined
              }
            />
          </div>
          <Names label="Searched" names={result.data.names} />
          <Names label="Matched recipients" names={result.data.recipients} />
          <div className="term-grid">
            <section className="term-block">
              <h3>Obligations by fiscal year</h3>
              {result.data.fiscalYears.length ? (
                <dl className="term-fields">
                  {result.data.fiscalYears.map((row) => (
                    <div key={row.year}>
                      <dt>FY{row.year}</dt>
                      <dd>{usd(row.amount)}</dd>
                    </div>
                  ))}
                </dl>
              ) : (
                <Empty title="No contract obligations" />
              )}
            </section>
            <section className="term-block term-wide">
              <h3>Largest contract actions, last 12 months</h3>
              <ActionTable rows={result.data.actions} />
            </section>
          </div>
        </div>
      )}
    </Gate>
  );
}

function FilingTable({
  rows,
  select,
}: {
  rows: LobbyingFeedData["filings"];
  select?: (symbol: string) => void;
}) {
  if (!rows.length) return <Empty title="No filings" />;
  return (
    <div className="desk-table-wrap">
      <table className="data-table alt-table">
        <thead>
          <tr>
            <th>Posted</th>
            {select ? <th>Ticker</th> : null}
            <th>Client</th>
            <th>Registrant</th>
            <th>Period</th>
            <th>Issues</th>
            <th className="num">Amount</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              <td>{dateLabel(row.posted)}</td>
              {select ? (
                <td>
                  {row.ticker ? (
                    <SymbolLink
                      symbol={row.ticker}
                      select={select}
                      label={row.client}
                    />
                  ) : (
                    "—"
                  )}
                </td>
              ) : null}
              <td>{row.client}</td>
              <td className="muted">{row.registrant}</td>
              <td className="muted">
                {row.period ?? "—"} {row.year}
              </td>
              <td
                className="muted"
                title={row.issues
                  .map((i) => i.description)
                  .filter(Boolean)
                  .join("\n\n")}
              >
                <Link href={row.url}>
                  {row.issues
                    .slice(0, 3)
                    .map((issue) => issue.label ?? issue.code)
                    .filter(Boolean)
                    .join(", ") || "—"}
                </Link>
              </td>
              <td className="num">{usd(row.amount)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function LobbyingFeed({ select }: { select: (symbol: string) => void }) {
  const state = useAlt<LobbyingFeedData>(
    "lobbying.recent",
    { limit: 100 },
    10 * MINUTE,
  );
  const door = useAlt<{ revolving: RevolvingLobbyist[] }>("lobbying.revolving");
  return (
    <Gate state={state}>
      {(result) => (
        <div className="term-stack">
          <div className="term-toolbar">
            <Provenance
              result={result}
              detail={`${result.data.filings.length} of ${result.data.scanned} filings posted in the last ${result.data.windowDays} days resolve to a listed company`}
            />
          </div>
          <div className="term-grid">
            <section className="term-block">
              <h3>Top spenders, last {result.data.windowDays} days</h3>
              {result.data.top.length ? (
                <table className="data-table alt-table">
                  <tbody>
                    {result.data.top.map((row) => (
                      <tr key={row.ticker}>
                        <td>
                          <SymbolLink
                            symbol={row.ticker}
                            select={select}
                            label={row.name}
                          />
                        </td>
                        <td className="muted">{row.filings} filings</td>
                        <td className="num">{usd(row.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <Empty title="No spenders" />
              )}
            </section>
            <section className="term-block term-wide">
              <h3>Latest filings</h3>
              <FilingTable rows={result.data.filings} select={select} />
            </section>
            <section className="term-block term-wide">
              <h3>Revolving door</h3>
              {door.data ? (
                <Revolving rows={door.data.data.revolving} select={select} />
              ) : door.error ? (
                <Failure error={door.error} retry={door.retry} />
              ) : (
                <Loading message="Loading" />
              )}
            </section>
          </div>
        </div>
      )}
    </Gate>
  );
}

export function LobbyingView({ ticker }: { ticker: string }) {
  const state = useAlt<LobbyingTicker>("lobbying.ticker", { symbol: ticker });
  return (
    <Gate state={state}>
      {(result) => (
        <div className="term-stack">
          <div className="term-toolbar">
            <Provenance
              result={result}
              detail={
                result.data.complete
                  ? undefined
                  : "year totals are lower bounds"
              }
            />
          </div>
          <Names label="Searched" names={result.data.names} />
          <Names label="Matched clients" names={result.data.clients} />
          <div className="term-grid">
            <section className="term-block">
              <h3>Spend by year</h3>
              {result.data.years.length ? (
                <dl className="term-fields">
                  {result.data.years.map((row) => (
                    <div key={row.year}>
                      <dt>
                        {row.year} · {row.filings} filings
                      </dt>
                      <dd>{usd(row.amount)}</dd>
                    </div>
                  ))}
                </dl>
              ) : (
                <Empty title="No filings" />
              )}
            </section>
            <section className="term-block term-wide">
              <h3>Filings</h3>
              <FilingTable rows={result.data.filings} />
            </section>
            <section className="term-block term-wide">
              <h3>Revolving-door lobbyists</h3>
              <Revolving rows={result.data.revolving} />
            </section>
          </div>
        </div>
      )}
    </Gate>
  );
}

export function PacFeed({ select }: { select: (symbol: string) => void }) {
  const state = useAlt<PacTop>("pac.top");
  return (
    <Gate state={state}>
      {(result) => (
        <div className="term-stack">
          <div className="term-toolbar">
            <Provenance
              result={result}
              detail={`${result.data.cycle} cycle · ${result.data.rows.length} of the ${result.data.scanned} biggest corporate PACs resolve to a listed company`}
            />
          </div>
          {result.data.rows.length ? (
            <div className="desk-table-wrap">
              <table className="data-table alt-table">
                <thead>
                  <tr>
                    <th>Ticker</th>
                    <th>Committee</th>
                    <th className="num">Receipts</th>
                    <th className="num">Disbursed</th>
                    <th className="num">Contributions</th>
                    <th>Through</th>
                  </tr>
                </thead>
                <tbody>
                  {result.data.rows.map((row) => (
                    <tr key={row.committeeId}>
                      <td>
                        <SymbolLink
                          symbol={row.ticker}
                          select={select}
                          label={row.company}
                        />
                      </td>
                      <td className="muted">{row.committee}</td>
                      <td className="num">{usd(row.receipts)}</td>
                      <td className="num">{usd(row.disbursements)}</td>
                      <td className="num">{usd(row.contributions)}</td>
                      <td className="muted">{dateLabel(row.coverageEnd)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty title="No corporate PACs" />
          )}
        </div>
      )}
    </Gate>
  );
}

const partyName = (party: string | null) =>
  party === "DEM"
    ? "Democratic"
    : party === "REP"
      ? "Republican"
      : (party ?? "Other");

export function PacView({ ticker }: { ticker: string }) {
  const state = useAlt<PacTicker>("pac.ticker", { symbol: ticker });
  return (
    <Gate state={state}>
      {(result) => (
        <div className="term-stack">
          <div className="term-toolbar">
            <Provenance
              result={result}
              detail={
                result.data.sampled
                  ? "latest 100 contributions only"
                  : undefined
              }
            />
          </div>
          <Names label="Searched" names={result.data.names} />
          <Names
            label="Matched committees"
            names={result.data.committees.map((row) => row.name)}
          />
          {result.data.committees.length ? (
            <div className="term-grid">
              {result.data.committees.map((committee) => (
                <section className="term-block" key={committee.id}>
                  <h3>{committee.name}</h3>
                  <table className="data-table alt-table">
                    <thead>
                      <tr>
                        <th>Cycle</th>
                        <th className="num">Receipts</th>
                        <th className="num">Disbursed</th>
                        <th className="num">Contributions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {committee.cycles.map((row) => (
                        <tr key={row.cycle}>
                          <td>{row.cycle}</td>
                          <td className="num">{usd(row.receipts)}</td>
                          <td className="num">{usd(row.disbursements)}</td>
                          <td className="num">{usd(row.contributions)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </section>
              ))}
              <section className="term-block">
                <h3>Party split, {result.data.cycle}</h3>
                <dl className="term-fields">
                  {result.data.parties.map((row) => (
                    <div key={row.party}>
                      <dt>
                        {partyName(row.party)} · {row.count}
                      </dt>
                      <dd>{usd(row.amount)}</dd>
                    </div>
                  ))}
                </dl>
              </section>
              <section className="term-block term-wide">
                <h3>Recent contributions</h3>
                {result.data.contributions.length ? (
                  <div className="desk-table-wrap">
                    <table className="data-table alt-table">
                      <thead>
                        <tr>
                          <th>Date</th>
                          <th>Recipient</th>
                          <th>Office</th>
                          <th>Party</th>
                          <th className="num">Amount</th>
                        </tr>
                      </thead>
                      <tbody>
                        {result.data.contributions.map((row, index) => (
                          <tr key={`${row.recipientId}-${row.date}-${index}`}>
                            <td>{dateLabel(row.date)}</td>
                            <td>{row.candidate ?? row.recipient}</td>
                            <td className="muted">{row.office ?? "—"}</td>
                            <td className="muted">{row.party ?? "—"}</td>
                            <td className="num">{usd(row.amount)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <Empty title="No contributions this cycle" />
                )}
              </section>
            </div>
          ) : (
            <Empty title="No corporate PAC found" />
          )}
        </div>
      )}
    </Gate>
  );
}
