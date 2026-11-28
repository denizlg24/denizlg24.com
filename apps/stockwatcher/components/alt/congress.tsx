"use client";

import { ExternalLink } from "lucide-react";
import { type ReactNode, useState } from "react";
import useSWR from "swr";
import { api, Empty, Failure, Loading } from "@/components/shared";
import {
  amountLabel,
  type Chamber,
  isSell,
  type MemberProfile,
  type NetWorth,
  sideLabel,
  type TickerActivity,
  type Trade,
  type TradeFeed,
} from "@/lib/alt/congress/types";
import type { AltResult } from "@/lib/alt/types";

const REFRESH_MS = 120_000;

const dayFormat = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
});
const dayLabel = (iso: string | null) =>
  iso ? dayFormat.format(new Date(`${iso.slice(0, 10)}T12:00:00Z`)) : "—";
const clock = new Intl.DateTimeFormat("en-GB", {
  hour: "2-digit",
  minute: "2-digit",
});
const usd = (value: number | null) =>
  value == null
    ? "—"
    : new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
        notation: "compact",
        maximumFractionDigits: 1,
      }).format(value);

const partyTag = (party: string | null) => (party ? party[0] : "—");
const chamberLabel: Record<Chamber, string> = {
  house: "House",
  senate: "Senate",
  executive: "OGE",
};

const dataset = (
  name: string,
  values: Record<string, string | number | undefined>,
) => {
  const params = new URLSearchParams({ dataset: name });
  for (const [key, value] of Object.entries(values))
    if (value !== undefined && value !== "") params.set(key, String(value));
  return `/api/alt?${params}`;
};

function useDataset<T>(url: string | null) {
  return useSWR<AltResult<T>>(url, api, {
    refreshInterval: REFRESH_MS,
    revalidateOnFocus: false,
    keepPreviousData: true,
  });
}

function Stamp({
  result,
  extra,
}: {
  result: AltResult<unknown> | undefined;
  extra?: string[];
}) {
  if (!result) return null;
  const parts = [
    result.source,
    result.asOf ? `latest filing ${dayLabel(result.asOf)}` : null,
    `fetched ${clock.format(new Date(result.fetchedAt))}`,
    result.stale ? "stale" : null,
    ...(extra ?? []),
  ].filter(Boolean);
  return <p className="term-source">{parts.join(" · ")}</p>;
}

function Warnings({ items }: { items: string[] }) {
  if (!items.length) return null;
  return (
    <ul className="term-source">
      {items.map((item) => (
        <li key={item}>{item}</li>
      ))}
    </ul>
  );
}

function Side({ trade }: { trade: Trade }) {
  return (
    <span
      className={
        trade.side === "buy" ? "positive" : isSell(trade.side) ? "negative" : ""
      }
    >
      {sideLabel[trade.side]}
    </span>
  );
}

function TradeTable({
  trades,
  select,
  openMember,
  showMember = true,
  showTicker = true,
}: {
  trades: Trade[];
  select?: (symbol: string) => void;
  openMember?: (bioguide: string) => void;
  showMember?: boolean;
  showTicker?: boolean;
}) {
  return (
    <div className="desk-table-wrap">
      <table className="data-table alt-table">
        <thead>
          <tr>
            <th>Traded</th>
            <th>Filed</th>
            {showMember ? <th>Member</th> : null}
            <th>Chamber</th>
            {showTicker ? <th>Ticker</th> : null}
            <th>Asset</th>
            <th>Side</th>
            <th className="num">Amount</th>
            <th aria-label="Filing" />
          </tr>
        </thead>
        <tbody>
          {trades.map((trade) => (
            <tr key={trade.id}>
              <td>{dayLabel(trade.transactedAt)}</td>
              <td className="muted">{dayLabel(trade.filedAt)}</td>
              {showMember ? (
                <td>
                  {trade.bioguide && openMember ? (
                    <button
                      type="button"
                      className="sym-link"
                      onClick={() => openMember(trade.bioguide ?? "")}
                    >
                      {trade.filer}
                    </button>
                  ) : (
                    trade.filer
                  )}{" "}
                  <small className="muted">
                    {partyTag(trade.party)}
                    {trade.state ? `-${trade.state}` : ""}
                  </small>
                </td>
              ) : null}
              <td className="muted">{chamberLabel[trade.chamber]}</td>
              {showTicker ? (
                <td>
                  {trade.ticker && select ? (
                    <button
                      type="button"
                      className="sym-link"
                      onClick={() => select(trade.ticker ?? "")}
                    >
                      {trade.ticker}
                    </button>
                  ) : (
                    (trade.ticker ?? "—")
                  )}
                </td>
              ) : null}
              <td title={trade.note ?? undefined}>
                {trade.asset}
                {trade.owner && trade.owner !== "self" ? (
                  <small className="muted"> · {trade.owner}</small>
                ) : null}
                {trade.ocr ? <small className="muted"> · OCR</small> : null}
              </td>
              <td>
                <Side trade={trade} />
              </td>
              <td className="num">
                {amountLabel(trade.amountMin, trade.amountMax)}
              </td>
              <td>
                <a
                  href={trade.url}
                  target="_blank"
                  rel="noreferrer"
                  aria-label="Open filing"
                >
                  <ExternalLink size={13} aria-hidden />
                </a>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: [T, string][];
  onChange: (value: T) => void;
}) {
  return (
    <div className="seg" role="group" aria-label={label}>
      {options.map(([key, text]) => (
        <button
          key={key}
          type="button"
          aria-pressed={value === key}
          onClick={() => onChange(key)}
        >
          {text}
        </button>
      ))}
    </div>
  );
}

function UnparsedFilings({ feed }: { feed: TradeFeed }) {
  if (!feed.filings.length && !feed.pending) return null;
  return (
    <section className="term-block">
      <h3>Not read</h3>
      {feed.pending ? (
        <p className="term-source">{feed.pending} filings queued</p>
      ) : null}
      <ul className="term-source">
        {feed.filings
          .filter((filing) => filing.reason !== "queued")
          .slice(0, 12)
          .map((filing) => (
            <li key={`${filing.chamber}-${filing.id}`}>
              {dayLabel(filing.filedAt)} · {filing.filer} ·{" "}
              {filing.reason ?? "unparsed"} ·{" "}
              <a href={filing.url} target="_blank" rel="noreferrer">
                open
              </a>
            </li>
          ))}
      </ul>
    </section>
  );
}

type Party = "all" | "Democrat" | "Republican";
type SideFilter = "all" | "buy" | "sell";
type ChamberFilter = "all" | "house" | "senate";

export function CongressFeed({ select }: { select: (symbol: string) => void }) {
  const chamber: ChamberFilter = "all";
  const [party, setParty] = useState<Party>("all");
  const [side, setSide] = useState<SideFilter>("all");
  const [days, setDays] = useState(30);
  const [member, setMember] = useState<string | null>(null);
  const { data, error, isLoading, mutate } = useDataset<TradeFeed>(
    member
      ? null
      : dataset("congress.trades", {
          chamber,
          days,
          limit: 200,
          party: party === "all" ? undefined : party,
          side: side === "all" ? undefined : side,
        }),
  );
  if (member)
    return (
      <CongressMemberView
        bioguide={member}
        back={() => setMember(null)}
        select={select}
      />
    );
  return (
    <div className="term-stack">
      <div className="term-toolbar">
        <div className="row-actions">
          <Segmented<Party>
            label="Party"
            value={party}
            onChange={setParty}
            options={[
              ["all", "All"],
              ["Democrat", "Dem"],
              ["Republican", "Rep"],
            ]}
          />
          <Segmented<SideFilter>
            label="Side"
            value={side}
            onChange={setSide}
            options={[
              ["all", "All"],
              ["buy", "Buys"],
              ["sell", "Sells"],
            ]}
          />
          <Segmented<string>
            label="Window"
            value={String(days)}
            onChange={(value) => setDays(Number(value))}
            options={[
              ["7", "7d"],
              ["30", "30d"],
              ["90", "90d"],
              ["365", "1y"],
            ]}
          />
        </div>
        <span className="term-source">
          {data
            ? `${data.data.trades.length} of ${data.data.total} trades`
            : ""}
        </span>
      </div>
      <Failure error={error} retry={mutate} />
      {isLoading && !data ? (
        <Loading message="Loading congressional trades" />
      ) : null}
      {data ? (
        data.data.trades.length ? (
          <TradeTable
            trades={data.data.trades}
            select={select}
            openMember={setMember}
          />
        ) : (
          <Empty title="No trades in this window" />
        )
      ) : null}
      {data ? <UnparsedFilings feed={data.data} /> : null}
      {data ? <Warnings items={data.data.warnings} /> : null}
      <Stamp
        result={data}
        extra={["amounts are ranges; filings lag trades by up to 45 days"]}
      />
    </div>
  );
}

function Money({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function NetWorthBlock({ worth }: { worth: NetWorth }) {
  const held = [...worth.holdings]
    .sort((a, b) => (b.valueMin ?? 0) - (a.valueMin ?? 0))
    .slice(0, 25);
  return (
    <section className="term-block term-wide">
      <h3>Net worth estimate · {worth.year} annual report</h3>
      <dl className="term-fields">
        <Money label="Net worth (midpoint)" value={usd(worth.netWorthMid)} />
        <Money label="Assets (midpoint)" value={usd(worth.assetsMid)} />
        <Money
          label="Assets (range)"
          value={`${usd(worth.assetsLow)} – ${usd(worth.assetsHigh)}`}
        />
        <Money
          label="Liabilities (midpoint)"
          value={usd(worth.liabilitiesMid)}
        />
        <Money label="Assets listed" value={worth.holdingsCount} />
      </dl>
      {worth.flags.length ? (
        <p className="term-source">{worth.flags.join(" · ")}</p>
      ) : null}
      <div className="desk-table-wrap">
        <table className="data-table alt-table">
          <thead>
            <tr>
              <th>Asset</th>
              <th>Ticker</th>
              <th>Owner</th>
              <th className="num">Value</th>
            </tr>
          </thead>
          <tbody>
            {held.map((holding, index) => (
              <tr key={`${holding.asset}-${index}`}>
                <td>{holding.asset}</td>
                <td>{holding.ticker ?? "—"}</td>
                <td className="muted">{holding.owner ?? "self"}</td>
                <td className="num">
                  {amountLabel(holding.valueMin, holding.valueMax)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="term-source">
        <a href={worth.url} target="_blank" rel="noreferrer">
          Filed {dayLabel(worth.filedAt)}
        </a>
      </p>
    </section>
  );
}

export function CongressMemberView({
  bioguide,
  back,
  select,
}: {
  bioguide: string;
  back?: () => void;
  select?: (symbol: string) => void;
}) {
  const { data, error, isLoading, mutate } = useDataset<MemberProfile>(
    dataset("congress.member", { bioguide }),
  );
  const profile = data?.data;
  return (
    <div className="term-stack">
      {back ? (
        <div className="term-toolbar">
          <button type="button" className="chip" onClick={back}>
            Back
          </button>
        </div>
      ) : null}
      <Failure error={error} retry={mutate} />
      {isLoading && !data ? <Loading message="Loading member" /> : null}
      {profile ? (
        <>
          <section className="term-block">
            <h3>{profile.member?.name ?? bioguide}</h3>
            {profile.member ? (
              <p className="term-source">
                {chamberLabel[profile.member.chamber]} · {profile.member.party}{" "}
                · {profile.member.state}
                {profile.member.district ? `-${profile.member.district}` : ""} ·{" "}
                {profile.tradeTotal} disclosed trades
              </p>
            ) : null}
          </section>
          {profile.netWorth ? <NetWorthBlock worth={profile.netWorth} /> : null}
          <section className="term-block term-wide">
            <h3>Trades</h3>
            {profile.trades.length ? (
              <TradeTable
                trades={profile.trades}
                select={select}
                showMember={false}
              />
            ) : (
              <Empty title="No disclosed trades read yet" />
            )}
          </section>
          {profile.filings.length ? (
            <section className="term-block">
              <h3>Filings</h3>
              <ul className="term-source">
                {profile.filings.map((filing) => (
                  <li key={`${filing.kind}-${filing.id}`}>
                    {dayLabel(filing.filedAt)} ·{" "}
                    {filing.kind === "ptr" ? "Periodic transactions" : "Annual"}{" "}
                    ·{" "}
                    {filing.parsed
                      ? `${filing.tradeCount} rows`
                      : (filing.reason ?? "not read")}{" "}
                    ·{" "}
                    <a href={filing.url} target="_blank" rel="noreferrer">
                      open
                    </a>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
          <Warnings items={profile.warnings} />
        </>
      ) : null}
      <Stamp result={data} />
    </div>
  );
}

export function CongressTickerView({ ticker }: { ticker: string }) {
  const [member, setMember] = useState<string | null>(null);
  const { data, error, isLoading, mutate } = useDataset<TickerActivity>(
    member
      ? null
      : dataset("congress.holdings", { symbol: ticker, days: 730, limit: 100 }),
  );
  if (member)
    return (
      <CongressMemberView bioguide={member} back={() => setMember(null)} />
    );
  const activity = data?.data;
  return (
    <div className="term-grid">
      <Failure error={error} retry={mutate} />
      {isLoading && !data ? (
        <Loading message="Loading congressional activity" />
      ) : null}
      {activity ? (
        <>
          <section className="term-block term-wide">
            <h3>Members</h3>
            {activity.holders.length ? (
              <div className="desk-table-wrap">
                <table className="data-table alt-table">
                  <thead>
                    <tr>
                      <th>Member</th>
                      <th>Chamber</th>
                      <th className="num">Buys</th>
                      <th className="num">Sells</th>
                      <th className="num">Amount</th>
                      <th>Last trade</th>
                      <th className="num">Reported holding</th>
                    </tr>
                  </thead>
                  <tbody>
                    {activity.holders.map((holder) => (
                      <tr key={holder.bioguide ?? holder.filer}>
                        <td>
                          {holder.bioguide ? (
                            <button
                              type="button"
                              className="sym-link"
                              onClick={() => setMember(holder.bioguide ?? "")}
                            >
                              {holder.filer}
                            </button>
                          ) : (
                            holder.filer
                          )}{" "}
                          <small className="muted">
                            {partyTag(holder.party)}
                            {holder.state ? `-${holder.state}` : ""}
                          </small>
                        </td>
                        <td className="muted">
                          {chamberLabel[holder.chamber]}
                        </td>
                        <td className="num">{holder.buys}</td>
                        <td className="num">{holder.sells}</td>
                        <td className="num">
                          {holder.trades
                            ? amountLabel(holder.amountLow, holder.amountHigh)
                            : "—"}
                        </td>
                        <td>{dayLabel(holder.lastTradeAt)}</td>
                        <td className="num">
                          {holder.holding
                            ? amountLabel(
                                holder.holding.valueMin,
                                holder.holding.valueMax,
                              )
                            : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <Empty title={`No congressional trades in ${ticker}`} />
            )}
          </section>
          {activity.trades.length ? (
            <section className="term-block term-wide">
              <h3>Trades</h3>
              <TradeTable
                trades={activity.trades}
                openMember={setMember}
                showTicker={false}
              />
            </section>
          ) : null}
          <Warnings items={activity.warnings} />
        </>
      ) : null}
      <Stamp result={data} extra={["amounts are ranges"]} />
    </div>
  );
}

export function TrumpFeed({ select }: { select: (symbol: string) => void }) {
  const [side, setSide] = useState<SideFilter>("all");
  const [days, setDays] = useState(365);
  const { data, error, isLoading, mutate } = useDataset<TradeFeed>(
    dataset("trump.trades", {
      days,
      limit: 300,
      side: side === "all" ? undefined : side,
    }),
  );
  return (
    <div className="term-stack">
      <div className="term-toolbar">
        <div className="row-actions">
          <Segmented<SideFilter>
            label="Side"
            value={side}
            onChange={setSide}
            options={[
              ["all", "All"],
              ["buy", "Buys"],
              ["sell", "Sells"],
            ]}
          />
          <Segmented<string>
            label="Window"
            value={String(days)}
            onChange={(next) => setDays(Number(next))}
            options={[
              ["90", "90d"],
              ["365", "1y"],
              ["730", "2y"],
            ]}
          />
        </div>
        <span className="term-source">
          {data
            ? `${data.data.trades.length} of ${data.data.total} trades`
            : ""}
        </span>
      </div>
      <Failure error={error} retry={mutate} />
      {isLoading && !data ? (
        <Loading message="Loading presidential transaction reports" />
      ) : null}
      {data ? (
        data.data.trades.length ? (
          <TradeTable trades={data.data.trades} select={select} />
        ) : (
          <Empty title="No transactions in this window" />
        )
      ) : null}
      {data ? <UnparsedFilings feed={data.data} /> : null}
      {data ? <Warnings items={data.data.warnings} /> : null}
      <Stamp result={data} extra={["OGE Form 278-T; amounts are ranges"]} />
    </div>
  );
}
