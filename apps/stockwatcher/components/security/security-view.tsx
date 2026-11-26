"use client";

import { ExternalLink } from "lucide-react";
import { type ReactNode, useState } from "react";
import useSWR from "swr";
import { Freshness } from "@/components/freshness";
import { ChartPanel, useQuotes } from "@/components/market-widgets";
import {
  api,
  Change,
  Empty,
  Failure,
  Loading,
  signed,
  Tick,
} from "@/components/shared";
import type {
  ChartPreferences,
  ChartTemplate,
  Drawing,
  RelationNote,
  Workspace,
} from "@/lib/models";
import type {
  Actions,
  AnalystView,
  Earnings,
  Financials,
  Holders,
  InstrumentProfile,
  MarketStats,
  People,
  Relationships,
  RelayNews,
} from "@/lib/security-types";
import { type SecurityFunction, securityFunctions } from "@/lib/terminal";
import { amount, compact, number, percent, tone } from "@/lib/utils";
import { FunctionBar } from "./functions";
import { Backtest, BetaView, SeasonalityView, Volatility } from "./quant";
import { SupplyChain } from "./supply-chain";

type Fetch<T> = {
  data?: T;
  error?: Error;
  isLoading: boolean;
  retry: () => void;
};

function useSecurity<T>(
  ticker: string,
  fn: string,
  extra: Record<string, string> = {},
): Fetch<T> {
  const { data, error, isLoading, mutate } = useSWR<T>(
    `/api/security?${new URLSearchParams({ symbol: ticker, fn, ...extra })}`,
    api,
    { errorRetryCount: 1, revalidateOnFocus: false },
  );
  return { data, error, isLoading, retry: () => void mutate() };
}

function Gate<T>({
  state,
  children,
}: {
  state: Fetch<T>;
  children: (data: T) => ReactNode;
}) {
  if (state.error) return <Failure error={state.error} retry={state.retry} />;
  if (state.isLoading || !state.data) return <Loading message="Loading" />;
  return <>{children(state.data)}</>;
}

const fraction = (value: number | null | undefined) =>
  value == null ? "—" : `${amount(value * 100)}%`;
const signedFraction = (value: number | null | undefined) =>
  value == null ? null : value * 100;
const ratio = (value: number | null | undefined) =>
  value == null ? "—" : `${number(value)}x`;
const dateLabel = (iso: string | null | undefined) =>
  iso
    ? new Intl.DateTimeFormat("en-GB", {
        day: "numeric",
        month: "short",
        year: "numeric",
      }).format(new Date(`${iso.slice(0, 10)}T12:00:00Z`))
    : "—";

function Fields({
  title,
  rows,
}: {
  title: string;
  rows: [string, ReactNode][];
}) {
  return (
    <section className="term-block">
      <h3>{title}</h3>
      <dl className="term-fields">
        {rows.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function Description({ ticker }: { ticker: string }) {
  const state = useSecurity<{
    instrument: InstrumentProfile;
    stats: MarketStats | null;
  }>(ticker, "des");
  return (
    <Gate state={state}>
      {({ instrument, stats }) => {
        const profile = instrument.profile;
        const v = stats?.valuation;
        const p = stats?.profitability;
        const t = stats?.trading;
        const d = stats?.dividends;
        const f = stats?.fundamentals;
        return (
          <div className="term-grid">
            <section className="term-block term-wide">
              <h3>{instrument.symbol.name}</h3>
              <p className="term-meta">
                {[
                  profile.sector,
                  profile.industry,
                  profile.country,
                  profile.employees
                    ? `${number(profile.employees)} employees`
                    : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
                {profile.website ? (
                  <>
                    {" · "}
                    <a href={profile.website} target="_blank" rel="noreferrer">
                      {profile.website.replace(/^https?:\/\/(www\.)?/, "")}
                      <ExternalLink size={11} aria-hidden />
                    </a>
                  </>
                ) : null}
              </p>
              {profile.description ? (
                <p className="term-description">{profile.description}</p>
              ) : null}
            </section>
            {stats ? (
              <>
                <Fields
                  title="Valuation"
                  rows={[
                    ["Market cap", compact(v?.marketCap)],
                    ["Enterprise value", compact(v?.enterpriseValue)],
                    ["P/E (ttm)", ratio(v?.trailingPE)],
                    ["P/E (fwd)", ratio(v?.forwardPE)],
                    ["PEG", number(v?.pegRatio)],
                    ["P/B", ratio(v?.priceToBook)],
                    ["P/S", ratio(v?.priceToSales)],
                    ["EV/EBITDA", ratio(v?.evToEbitda)],
                    ["EV/Revenue", ratio(v?.evToRevenue)],
                  ]}
                />
                <Fields
                  title="Profitability"
                  rows={[
                    ["Gross margin", fraction(p?.grossMargin)],
                    ["Operating margin", fraction(p?.operatingMargin)],
                    ["Profit margin", fraction(p?.profitMargin)],
                    ["ROE", fraction(p?.returnOnEquity)],
                    ["ROA", fraction(p?.returnOnAssets)],
                    [
                      "Revenue growth",
                      <Change
                        key="rg"
                        value={signedFraction(p?.revenueGrowth)}
                      />,
                    ],
                    [
                      "Earnings growth",
                      <Change
                        key="eg"
                        value={signedFraction(p?.earningsGrowth)}
                      />,
                    ],
                  ]}
                />
                <Fields
                  title="Trading"
                  rows={[
                    ["Beta", number(t?.beta)],
                    [
                      "52w range",
                      `${amount(t?.fiftyTwoWeekLow)} – ${amount(t?.fiftyTwoWeekHigh)}`,
                    ],
                    [
                      "52w change",
                      <Change
                        key="52"
                        value={signedFraction(t?.fiftyTwoWeekChange)}
                      />,
                    ],
                    ["50d avg", amount(t?.fiftyDayAverage)],
                    ["200d avg", amount(t?.twoHundredDayAverage)],
                    ["Avg volume", compact(t?.averageVolume)],
                    ["Avg vol 10d", compact(t?.averageVolume10d)],
                    ["Shares out", compact(t?.sharesOutstanding)],
                    ["Float", compact(t?.floatShares)],
                    ["Short % float", fraction(t?.shortPercentOfFloat)],
                    ["Days to cover", number(t?.shortRatio)],
                    ["Insiders", fraction(t?.heldPercentInsiders)],
                    ["Institutions", fraction(t?.heldPercentInstitutions)],
                  ]}
                />
                <Fields
                  title="Fundamentals"
                  rows={[
                    ["Revenue (ttm)", compact(f?.totalRevenue)],
                    ["EBITDA", compact(f?.ebitda)],
                    ["Net income", compact(f?.netIncome)],
                    ["Operating CF", compact(f?.operatingCashflow)],
                    ["Free cash flow", compact(f?.freeCashflow)],
                    ["Cash", compact(f?.totalCash)],
                    ["Debt", compact(f?.totalDebt)],
                    ["Debt/Equity", number(f?.debtToEquity)],
                    ["Current ratio", number(f?.currentRatio)],
                    ["Quick ratio", number(f?.quickRatio)],
                    ["EPS (ttm)", amount(f?.trailingEps)],
                    ["EPS (fwd)", amount(f?.forwardEps)],
                    ["Book value/sh", amount(f?.bookValue)],
                  ]}
                />
                <Fields
                  title="Dividend"
                  rows={[
                    ["Annual rate", amount(d?.dividendRate)],
                    ["Yield", fraction(d?.dividendYield)],
                    ["5y avg yield", fraction(d?.fiveYearAvgDividendYield)],
                    ["Payout ratio", fraction(d?.payoutRatio)],
                    ["Ex-dividend", dateLabel(d?.exDividendDate)],
                  ]}
                />
              </>
            ) : (
              <Empty title="Key statistics unavailable" />
            )}
            <p className="term-source">
              Yahoo Finance via markets relay
              {stats?.currency ? ` · ${stats.currency}` : ""}
              {stats?.financialCurrency &&
              stats.financialCurrency !== stats.currency
                ? ` · financials in ${stats.financialCurrency}`
                : ""}
              {stats?.freshness.stale ? " · stale" : ""}
            </p>
          </div>
        );
      }}
    </Gate>
  );
}

const statements = [
  ["income", "Income"],
  ["balance", "Balance sheet"],
  ["cashFlow", "Cash flow"],
] as const;
const leading: Record<string, string[]> = {
  income: [
    "Total Revenue",
    "Gross Profit",
    "Operating Income",
    "EBITDA",
    "Net Income",
    "Diluted EPS",
    "Basic EPS",
  ],
  balance: [
    "Total Assets",
    "Total Liabilities Net Minority Interest",
    "Stockholders Equity",
    "Cash And Cash Equivalents",
    "Total Debt",
    "Net Debt",
    "Working Capital",
  ],
  cashFlow: [
    "Operating Cash Flow",
    "Capital Expenditure",
    "Free Cash Flow",
    "Repurchase Of Capital Stock",
    "Cash Dividends Paid",
  ],
};

function FinancialAnalysis({ ticker }: { ticker: string }) {
  const [statement, setStatement] =
    useState<(typeof statements)[number][0]>("income");
  const [frequency, setFrequency] = useState<"yearly" | "quarterly">("yearly");
  const state = useSecurity<Financials>(ticker, "fa", { statement, frequency });
  return (
    <div className="term-stack">
      <div className="term-toolbar">
        <div className="seg" role="group" aria-label="Statement">
          {statements.map(([key, label]) => (
            <button
              key={key}
              type="button"
              aria-pressed={statement === key}
              onClick={() => setStatement(key)}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="seg" role="group" aria-label="Frequency">
          {(["yearly", "quarterly"] as const).map((key) => (
            <button
              key={key}
              type="button"
              aria-pressed={frequency === key}
              onClick={() => setFrequency(key)}
            >
              {key === "yearly" ? "Annual" : "Quarterly"}
            </button>
          ))}
        </div>
      </div>
      <Gate state={state}>
        {(data) => {
          const periods = data.periods.slice(0, frequency === "yearly" ? 5 : 6);
          if (!periods.length)
            return <Empty title="No reported periods for this statement" />;
          const keys = [
            ...new Set(periods.flatMap((period) => Object.keys(period.values))),
          ];
          const priority = leading[statement] ?? [];
          const ordered = [
            ...priority.filter((key) => keys.includes(key)),
            ...keys.filter((key) => !priority.includes(key)).sort(),
          ];
          return (
            <div className="desk-table-wrap term-table-wrap">
              <table className="data-table term-table">
                <thead>
                  <tr>
                    <th>
                      {statements.find(([key]) => key === statement)?.[1]}
                    </th>
                    {periods.map((period) => (
                      <th key={period.date} className="num">
                        {period.date}
                      </th>
                    ))}
                    <th className="num" title="Change versus the prior period">
                      Δ
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {ordered.map((key) => {
                    const latest = periods[0]?.values[key];
                    const prior = periods[1]?.values[key];
                    const change =
                      latest != null && prior
                        ? ((latest - prior) / Math.abs(prior)) * 100
                        : null;
                    return (
                      <tr
                        key={key}
                        data-lead={priority.includes(key) || undefined}
                      >
                        <td>{key}</td>
                        {periods.map((period) => {
                          const value = period.values[key];
                          return (
                            <td key={period.date} className="num">
                              {value == null
                                ? "—"
                                : Math.abs(value) < 1000
                                  ? number(value)
                                  : compact(value)}
                            </td>
                          );
                        })}
                        <td className="num">
                          <Change value={change} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          );
        }}
      </Gate>
    </div>
  );
}

const gradeTone = (grade: string | null) => {
  const text = grade?.toLowerCase() ?? "";
  if (/buy|outperform|overweight|positive/.test(text)) return "positive";
  if (/sell|underperform|underweight|negative|reduce/.test(text))
    return "negative";
  return "neutral";
};

function Analysts({ ticker }: { ticker: string }) {
  const state = useSecurity<AnalystView>(ticker, "anr");
  return (
    <Gate state={state}>
      {(data) => {
        const { targets, recommendation } = data;
        const low = targets.low ?? 0;
        const high = targets.high ?? 0;
        const spread = high - low;
        const position = (value: number | null) =>
          value == null || spread <= 0
            ? null
            : Math.min(100, Math.max(0, ((value - low) / spread) * 100));
        const upside =
          targets.mean != null && targets.current
            ? (targets.mean / targets.current - 1) * 100
            : null;
        return (
          <div className="term-grid">
            <section className="term-block">
              <h3>Consensus</h3>
              <div className="term-figure">
                <strong
                  className={
                    recommendation.key ? gradeTone(recommendation.key) : ""
                  }
                >
                  {recommendation.key?.replace("_", " ").toUpperCase() ?? "—"}
                </strong>
                <span>
                  {number(recommendation.mean)} on 1 (strong buy) – 5 (sell) ·{" "}
                  {number(recommendation.analysts)} analysts
                </span>
              </div>
              {recommendation.mean != null ? (
                <div className="term-scale" aria-hidden>
                  <i
                    style={{
                      left: `${((recommendation.mean - 1) / 4) * 100}%`,
                    }}
                  />
                </div>
              ) : null}
            </section>
            <section className="term-block">
              <h3>12-month target</h3>
              <div className="term-figure">
                <strong>{amount(targets.mean)}</strong>
                <span>
                  mean · median {amount(targets.median)} ·{" "}
                  <Change value={upside} /> vs last
                </span>
              </div>
              {spread > 0 ? (
                <div className="target-range">
                  <div className="target-track">
                    {(
                      [
                        ["current", targets.current, "Last"],
                        ["mean", targets.mean, "Mean"],
                      ] as const
                    ).map(([key, value, label]) =>
                      position(value) == null ? null : (
                        <i
                          key={key}
                          data-kind={key}
                          style={{ left: `${position(value)}%` }}
                          title={`${label} ${amount(value)}`}
                        />
                      ),
                    )}
                  </div>
                  <div className="target-ends">
                    <span>Low {amount(targets.low)}</span>
                    <span>High {amount(targets.high)}</span>
                  </div>
                </div>
              ) : null}
            </section>
            <section className="term-block term-wide">
              <h3>Recommendation trend</h3>
              {data.trend.length ? (
                <ul className="trend-bars">
                  {data.trend.map((row) => {
                    const total =
                      row.strongBuy +
                        row.buy +
                        row.hold +
                        row.sell +
                        row.strongSell || 1;
                    return (
                      <li key={row.period}>
                        <span>
                          {row.period === "0m"
                            ? "Now"
                            : row.period.replace("m", " mo")}
                        </span>
                        <div className="trend-bar">
                          {(
                            [
                              ["strongBuy", row.strongBuy, "Strong buy"],
                              ["buy", row.buy, "Buy"],
                              ["hold", row.hold, "Hold"],
                              ["sell", row.sell, "Sell"],
                              ["strongSell", row.strongSell, "Strong sell"],
                            ] as const
                          ).map(([key, count, label]) =>
                            count ? (
                              <i
                                key={key}
                                data-kind={key}
                                style={{ width: `${(count / total) * 100}%` }}
                                title={`${label}: ${count}`}
                              >
                                {count}
                              </i>
                            ) : null,
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <Empty title="No rating history" />
              )}
            </section>
            <section className="term-block term-wide">
              <h3>Rating changes</h3>
              {data.changes.length ? (
                <div className="desk-table-wrap">
                  <table className="data-table term-table">
                    <thead>
                      <tr>
                        <th>Date</th>
                        <th>Firm</th>
                        <th>Action</th>
                        <th>From</th>
                        <th>To</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.changes.map((row, i) => (
                        <tr key={`${row.date}-${row.firm}-${i}`}>
                          <td>{dateLabel(row.date)}</td>
                          <td>{row.firm ?? "—"}</td>
                          <td className="muted">{row.action ?? "—"}</td>
                          <td className={gradeTone(row.fromGrade)}>
                            {row.fromGrade || "—"}
                          </td>
                          <td className={gradeTone(row.toGrade)}>
                            {row.toGrade || "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <Empty title="No recent rating changes" />
              )}
            </section>
          </div>
        );
      }}
    </Gate>
  );
}

function EarningsView({ ticker }: { ticker: string }) {
  const state = useSecurity<Earnings>(ticker, "ern");
  return (
    <Gate state={state}>
      {(data) => {
        const largest = Math.max(
          0.01,
          ...data.history.map((row) => Math.abs(row.surprisePercent ?? 0)),
        );
        return (
          <div className="term-grid">
            <Fields
              title="Next report"
              rows={
                data.next
                  ? [
                      ["Date", dateLabel(data.next.date)],
                      ["EPS estimate", amount(data.next.epsEstimate)],
                      [
                        "EPS range",
                        `${amount(data.next.epsLow)} – ${amount(data.next.epsHigh)}`,
                      ],
                      ["Revenue estimate", compact(data.next.revenueEstimate)],
                      [
                        "Revenue range",
                        `${compact(data.next.revenueLow)} – ${compact(data.next.revenueHigh)}`,
                      ],
                    ]
                  : [["Date", "Not announced"]]
              }
            />
            <section className="term-block term-wide">
              <h3>EPS history</h3>
              {data.history.length ? (
                <table className="data-table term-table">
                  <thead>
                    <tr>
                      <th>Reported</th>
                      <th className="num">Estimate</th>
                      <th className="num">Actual</th>
                      <th className="num">Surprise</th>
                      <th aria-label="Surprise bar" />
                    </tr>
                  </thead>
                  <tbody>
                    {data.history.map((row) => {
                      const surprise = signedFraction(row.surprisePercent);
                      return (
                        <tr key={row.date}>
                          <td>{dateLabel(row.date)}</td>
                          <td className="num">{amount(row.epsEstimate)}</td>
                          <td className="num">{amount(row.epsActual)}</td>
                          <td className="num">
                            <Change value={surprise} />
                          </td>
                          <td className="surprise-cell">
                            {row.surprisePercent != null ? (
                              <i
                                className={tone(row.surprisePercent)}
                                style={{
                                  width: `${(Math.abs(row.surprisePercent) / largest) * 50}%`,
                                }}
                              />
                            ) : null}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              ) : (
                <Empty title="No reported earnings" />
              )}
            </section>
          </div>
        );
      }}
    </Gate>
  );
}

function HolderTable({
  title,
  rows,
}: {
  title: string;
  rows: Holders["institutions"];
}) {
  return (
    <section className="term-block term-wide">
      <h3>{title}</h3>
      {rows.length ? (
        <div className="desk-table-wrap">
          <table className="data-table term-table">
            <thead>
              <tr>
                <th>Holder</th>
                <th className="num">Shares</th>
                <th className="num">Value</th>
                <th className="num">% out</th>
                <th className="num">Chg</th>
                <th className="num">Reported</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.holder}>
                  <td>{row.holder}</td>
                  <td className="num">{compact(row.shares)}</td>
                  <td className="num">{compact(row.value)}</td>
                  <td className="num">{fraction(row.percentHeld)}</td>
                  <td className="num">
                    <Change value={signedFraction(row.change)} />
                  </td>
                  <td className="num muted">{dateLabel(row.reportedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <Empty title="No filings reported" />
      )}
    </section>
  );
}

function HoldersView({ ticker }: { ticker: string }) {
  const state = useSecurity<Holders>(ticker, "hds");
  return (
    <Gate state={state}>
      {(data) => (
        <div className="term-grid">
          <Fields
            title="Ownership"
            rows={[
              ["Insiders", fraction(data.breakdown.insidersPercent)],
              ["Institutions", fraction(data.breakdown.institutionsPercent)],
              [
                "Institutions % float",
                fraction(data.breakdown.institutionsFloatPercent),
              ],
              [
                "Institutional holders",
                number(data.breakdown.institutionsCount),
              ],
            ]}
          />
          <HolderTable title="Top institutions" rows={data.institutions} />
          <HolderTable title="Top funds" rows={data.funds} />
          <section className="term-block term-wide">
            <h3>Insider transactions</h3>
            {data.insiders.length ? (
              <div className="desk-table-wrap">
                <table className="data-table term-table">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Insider</th>
                      <th>Relation</th>
                      <th>Transaction</th>
                      <th className="num">Shares</th>
                      <th className="num">Value</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.insiders.map((row, i) => (
                      <tr key={`${row.date}-${row.name}-${i}`}>
                        <td>{dateLabel(row.date)}</td>
                        <td>{row.name ?? "—"}</td>
                        <td className="muted">{row.relation ?? "—"}</td>
                        <td
                          className={
                            /sale|sell/i.test(row.transaction ?? "")
                              ? "negative"
                              : /purchase|buy/i.test(row.transaction ?? "")
                                ? "positive"
                                : ""
                          }
                        >
                          {row.transaction ?? "—"}
                        </td>
                        <td className="num">{compact(row.shares)}</td>
                        <td className="num">{compact(row.value)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <Empty title="No recent insider transactions" />
            )}
          </section>
        </div>
      )}
    </Gate>
  );
}

const governanceLabels: [keyof People["governance"], string][] = [
  ["overallRisk", "Overall"],
  ["auditRisk", "Audit"],
  ["boardRisk", "Board"],
  ["compensationRisk", "Compensation"],
  ["shareHolderRightsRisk", "Shareholder rights"],
];

function Management({ ticker }: { ticker: string }) {
  const state = useSecurity<People>(ticker, "mgmt");
  return (
    <Gate state={state}>
      {(data) => (
        <div className="term-grid">
          <section className="term-block term-wide">
            <h3>Officers</h3>
            {data.officers.length ? (
              <table className="data-table term-table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Title</th>
                    <th className="num">Age</th>
                    <th className="num">Total pay</th>
                  </tr>
                </thead>
                <tbody>
                  {data.officers.map((row) => (
                    <tr key={row.name}>
                      <td>{row.name}</td>
                      <td className="muted">{row.title ?? "—"}</td>
                      <td className="num">{row.age ?? "—"}</td>
                      <td className="num">{compact(row.totalPay)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <Empty title="No officers listed" />
            )}
          </section>
          <section className="term-block">
            <h3>Governance risk</h3>
            <ul className="risk-bars">
              {governanceLabels.map(([key, label]) => {
                const value = data.governance[key];
                return (
                  <li key={key}>
                    <span>{label}</span>
                    <div>
                      {value != null ? (
                        <i
                          data-level={
                            value >= 7 ? "high" : value >= 4 ? "mid" : "low"
                          }
                          style={{ width: `${value * 10}%` }}
                        />
                      ) : null}
                    </div>
                    <b>{value ?? "—"}</b>
                  </li>
                );
              })}
            </ul>
            <p className="term-source">ISS scores, 1 (low risk) – 10 (high)</p>
          </section>
        </div>
      )}
    </Gate>
  );
}

function DividendsView({ ticker }: { ticker: string }) {
  const state = useSecurity<Actions>(ticker, "dvd");
  return (
    <Gate state={state}>
      {(data) => {
        const events = data.actions.toReversed();
        const dividends = events.filter((row) => row.divCash > 0);
        const splits = events.filter((row) => row.splitFactor !== 1);
        const yearAgo = new Date();
        yearAgo.setFullYear(yearAgo.getFullYear() - 1);
        const trailing = dividends
          .filter((row) => new Date(row.date) >= yearAgo)
          .reduce((sum, row) => sum + row.divCash, 0);
        return (
          <div className="term-grid">
            <Fields
              title="Summary"
              rows={[
                ["Trailing 12m", amount(trailing)],
                [
                  "Last paid",
                  dividends[0] ? amount(dividends[0].divCash) : "—",
                ],
                ["Last ex-date", dateLabel(dividends[0]?.date)],
                ["Payments on record", number(dividends.length)],
                [
                  "Last split",
                  splits[0]
                    ? `${number(splits[0].splitFactor)}:1 · ${dateLabel(splits[0].date)}`
                    : "—",
                ],
              ]}
            />
            <section className="term-block term-wide">
              <h3>Dividend history</h3>
              {dividends.length ? (
                <div className="desk-table-wrap term-table-wrap">
                  <table className="data-table term-table">
                    <thead>
                      <tr>
                        <th>Ex-date</th>
                        <th className="num">Amount</th>
                        <th className="num">Chg</th>
                      </tr>
                    </thead>
                    <tbody>
                      {dividends.slice(0, 40).map((row, i) => {
                        const prior = dividends[i + 1]?.divCash;
                        return (
                          <tr key={row.date}>
                            <td>{dateLabel(row.date)}</td>
                            <td className="num">{amount(row.divCash)}</td>
                            <td className="num">
                              <Change
                                value={
                                  prior ? (row.divCash / prior - 1) * 100 : null
                                }
                              />
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : (
                <Empty title="No dividends on record" />
              )}
            </section>
          </div>
        );
      }}
    </Gate>
  );
}

function CompanyNews({ ticker }: { ticker: string }) {
  const state = useSecurity<RelayNews>(ticker, "cn");
  return (
    <Gate state={state}>
      {(data) =>
        data.news.length ? (
          <ol className="term-news">
            {data.news.map((story) => (
              <li key={story.id}>
                <time dateTime={story.publishedAt}>
                  {new Intl.DateTimeFormat("en-GB", {
                    day: "2-digit",
                    month: "short",
                    hour: "2-digit",
                    minute: "2-digit",
                  }).format(new Date(story.publishedAt))}
                </time>
                <a href={story.url} target="_blank" rel="noreferrer">
                  {story.headline}
                </a>
                <span>{story.source ?? ""}</span>
              </li>
            ))}
          </ol>
        ) : (
          <Empty title="No recent headlines" />
        )
      }
    </Gate>
  );
}

type Node = {
  id: string;
  label: string;
  detail?: string;
  x: number;
  y: number;
  kind: "peer" | "holder" | "index" | "officer";
  tone?: string;
  symbol?: string;
};

const clip = (text: string, width: number) => {
  const max = Math.floor((width - 10) / 7);
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
};

function spread(
  items: Omit<Node, "x" | "y">[],
  from: { x: number; y: number },
  to: { x: number; y: number },
): Node[] {
  return items.map((item, i) => {
    const t = items.length === 1 ? 0.5 : i / (items.length - 1);
    return {
      ...item,
      x: from.x + (to.x - from.x) * t,
      y: from.y + (to.y - from.y) * t,
    };
  });
}

function RelationshipMap({
  ticker,
  select,
}: {
  ticker: string;
  select: (symbol: string) => void;
}) {
  const state = useSecurity<Relationships>(ticker, "rels");
  const peerSymbols = state.data?.peers.map((peer) => peer.ticker) ?? [];
  const { data: quotes } = useQuotes([ticker, ...peerSymbols], true);
  const bySymbol = new Map(
    quotes?.quotes.map((quote) => [quote.symbol, quote]),
  );
  return (
    <Gate state={state}>
      {(data) => {
        const W = 960;
        const H = 560;
        const cx = W / 2;
        const cy = H / 2;
        const self = bySymbol.get(ticker);
        const peers = spread(
          data.peers.slice(0, 8).map((peer) => {
            const quote = bySymbol.get(peer.ticker);
            return {
              id: `p-${peer.ticker}`,
              label: peer.ticker,
              detail: quote ? percent(quote.percent) : undefined,
              kind: "peer" as const,
              tone: tone(quote?.percent),
              symbol: peer.ticker,
            };
          }),
          { x: 80, y: 110 },
          { x: 80, y: H - 110 },
        );
        const holders = spread(
          data.holders.slice(0, 7).map((holder) => ({
            id: `h-${holder.holder}`,
            label:
              holder.holder.length > 28
                ? `${holder.holder.slice(0, 27)}…`
                : holder.holder,
            detail: fraction(holder.percentHeld),
            kind: "holder" as const,
          })),
          { x: W - 110, y: 110 },
          { x: W - 110, y: H - 110 },
        );
        const indices = spread(
          data.indices.slice(0, 4).map((name) => ({
            id: `i-${name}`,
            label: name,
            kind: "index" as const,
          })),
          { x: 220, y: 40 },
          { x: W - 220, y: 40 },
        );
        const officers = spread(
          data.officers.slice(0, 4).map((officer) => ({
            id: `o-${officer.name}`,
            label: officer.name.replace(/^(Mr|Ms|Mrs|Dr)\.?\s+/, ""),
            detail: officer.title?.split(/[,&]/)[0]?.trim(),
            kind: "officer" as const,
          })),
          { x: 220, y: H - 40 },
          { x: W - 220, y: H - 40 },
        );
        const nodes = [...peers, ...holders, ...indices, ...officers];
        return (
          <div className="rels">
            <div className="rels-legend">
              <span data-kind="peer">Similar companies</span>
              <span data-kind="holder">Top holders</span>
              <span data-kind="index">Index & group membership</span>
              <span data-kind="officer">Officers</span>
              {data.industry ? (
                <span className="muted">
                  {data.sector} · {data.industry}
                </span>
              ) : null}
            </div>
            <svg
              viewBox={`0 0 ${W} ${H}`}
              className="rels-map"
              role="img"
              aria-label={`Relationship map for ${data.name}`}
            >
              {nodes.map((node) => (
                <line
                  key={`l-${node.id}`}
                  x1={cx}
                  y1={cy}
                  x2={node.x}
                  y2={node.y}
                  data-kind={node.kind}
                />
              ))}
              <g className="rels-center" data-tone={tone(self?.percent)}>
                <rect x={cx - 92} y={cy - 32} width={184} height={64} />
                <text x={cx} y={cy - 8} className="rels-title">
                  {ticker}
                </text>
                <text x={cx} y={cy + 9}>
                  {data.name.length > 28
                    ? `${data.name.slice(0, 27)}…`
                    : data.name}
                </text>
                <text x={cx} y={cy + 24} className={tone(self?.percent)}>
                  {self ? `${amount(self.price)} ${percent(self.percent)}` : ""}
                </text>
              </g>
              {nodes.map((node) => {
                const width =
                  node.kind === "peer"
                    ? 96
                    : node.kind === "holder"
                      ? 196
                      : 150;
                const clickable = Boolean(node.symbol);
                return (
                  <g
                    key={node.id}
                    className="rels-node"
                    data-kind={node.kind}
                    data-tone={node.tone}
                    transform={`translate(${node.x - width / 2} ${node.y - 18})`}
                    role={clickable ? "button" : undefined}
                    tabIndex={clickable ? 0 : undefined}
                    onClick={() => node.symbol && select(node.symbol)}
                    onKeyDown={(event) => {
                      if (
                        node.symbol &&
                        (event.key === "Enter" || event.key === " ")
                      )
                        select(node.symbol);
                    }}
                  >
                    <rect width={width} height={36} />
                    <text x={width / 2} y={15}>
                      {clip(node.label, width)}
                    </text>
                    {node.detail ? (
                      <text x={width / 2} y={29} className="rels-detail">
                        {clip(node.detail, width)}
                      </text>
                    ) : null}
                  </g>
                );
              })}
            </svg>
            <p className="term-source">
              Similar companies are Yahoo&apos;s co-viewed symbols, not a
              curated peer group. Supply-chain links are not available from
              public data.
            </p>
          </div>
        );
      }}
    </Gate>
  );
}

function SecurityHeader({
  ticker,
  refresh,
}: {
  ticker: string;
  refresh: boolean;
}) {
  const { data } = useQuotes([ticker], refresh);
  const quote = data?.quotes[0];
  return (
    <div className="security-header">
      <span className="security-code">{ticker}</span>
      <span className="security-name">{quote?.name ?? ""}</span>
      <strong>
        <Tick value={quote?.price} />
      </strong>
      <span className={tone(quote?.change)}>{signed(quote?.change)}</span>
      <Change value={quote?.percent} />
      <span className="muted">{quote?.currency}</span>
      <Freshness
        symbol={refresh ? ticker : undefined}
        quoteMs={quote ? quote.time * 1000 : null}
      />
    </div>
  );
}

export function SecurityView({
  ticker,
  fn,
  setFn,
  refresh,
  preferences,
  savePreferences,
  watch,
  onWatch,
  onResearch,
  select,
  openFunction,
  drawings,
  saveDrawings,
  alerts,
  createAlert,
  relations,
  saveRelations,
  templates,
  saveTemplates,
}: {
  ticker: string;
  fn: SecurityFunction;
  setFn: (fn: SecurityFunction) => void;
  refresh: boolean;
  preferences: ChartPreferences;
  savePreferences: (next: ChartPreferences) => Promise<void>;
  watch: boolean;
  onWatch: () => void;
  onResearch: () => void;
  select: (symbol: string) => void;
  openFunction?: (symbol: string, fn: SecurityFunction) => void;
  drawings?: Drawing[];
  saveDrawings?: (symbol: string, next: Drawing[]) => Promise<void>;
  alerts?: Workspace["alerts"];
  createAlert?: (
    symbol: string,
    target: number,
    direction: "above" | "below",
  ) => void;
  relations?: RelationNote[];
  saveRelations?: (next: RelationNote[]) => void;
  templates?: ChartTemplate[];
  saveTemplates?: (next: ChartTemplate[]) => void;
}) {
  if (fn === "GP")
    return (
      <ChartPanel
        key={ticker}
        ticker={ticker}
        refresh={refresh}
        watch={watch}
        onWatch={onWatch}
        onResearch={onResearch}
        onFunction={setFn}
        preferences={preferences}
        savePreferences={savePreferences}
        drawings={drawings}
        saveDrawings={saveDrawings}
        alerts={alerts}
        createAlert={createAlert}
        templates={templates}
        saveTemplates={saveTemplates}
      />
    );
  const info = securityFunctions.find((item) => item.code === fn);
  return (
    <section className="panel security-panel">
      <SecurityHeader ticker={ticker} refresh={refresh} />
      <FunctionBar active={fn} onSelect={setFn} />
      <h2 className="security-fn-title">
        {fn} <span>{info?.label}</span>
      </h2>
      {fn === "DES" ? <Description ticker={ticker} /> : null}
      {fn === "FA" ? <FinancialAnalysis ticker={ticker} /> : null}
      {fn === "ANR" ? <Analysts ticker={ticker} /> : null}
      {fn === "ERN" ? <EarningsView ticker={ticker} /> : null}
      {fn === "HDS" ? <HoldersView ticker={ticker} /> : null}
      {fn === "MGMT" ? <Management ticker={ticker} /> : null}
      {fn === "DVD" ? <DividendsView ticker={ticker} /> : null}
      {fn === "CN" ? <CompanyNews ticker={ticker} /> : null}
      {fn === "RELS" ? (
        <RelationshipMap ticker={ticker} select={select} />
      ) : null}
      {fn === "HVT" ? <Volatility ticker={ticker} /> : null}
      {fn === "BETA" ? <BetaView ticker={ticker} /> : null}
      {fn === "SEAS" ? <SeasonalityView ticker={ticker} /> : null}
      {fn === "BTST" ? <Backtest ticker={ticker} /> : null}
      {fn === "SPLC" ? (
        <SupplyChain
          ticker={ticker}
          select={select}
          openFunction={openFunction}
          notes={relations}
          saveNotes={saveRelations}
        />
      ) : null}
    </section>
  );
}
