"use client";

import { useState, type ReactNode } from "react";
import type { InferUITools } from "ai";
import type { StockwatcherTools } from "@/lib/ai/tools";
import { amount, compact, number, percent, tone } from "@/lib/utils";

type Tools = InferUITools<StockwatcherTools>;
type Success<N extends keyof Tools> = Exclude<
  Tools[N]["output"],
  { error: unknown }
>;

function Block({
  title,
  meta,
  children,
}: {
  title: string;
  meta?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="chat-tool">
      <div className="chat-tool-head">
        <span className="kicker">{title}</span>
        {meta ? <span className="chat-tool-meta">{meta}</span> : null}
      </div>
      {children}
    </div>
  );
}

const Signed = ({ value }: { value: number | null | undefined }) => (
  <span className={tone(value)}>{percent(value)}</span>
);

const Money = ({
  value,
  currency,
}: {
  value: number | null | undefined;
  currency: string;
}) => (
  <span className={tone(value)}>
    {value == null ? "—" : `${value > 0 ? "+" : ""}${compact(value)} ${currency}`}
  </span>
);

function Failure({ currency, error }: { currency: string; error: string }) {
  return (
    <div className="chat-tool-foot">
      <span>
        {currency}: {error}
      </span>
    </div>
  );
}

function Foot({ children }: { children: ReactNode }) {
  return (
    <div className="chat-tool-foot">
      <span>{children}</span>
    </div>
  );
}

type RiskOutput = Success<"getPortfolioRisk">;

const analysisTitle: Record<RiskOutput["analysis"], string> = {
  factors: "Factor exposure",
  attribution: "Attribution",
  stress: "Stress test",
  var: "Value at risk",
};

export function PortfolioRiskView({ data }: { data: RiskOutput }) {
  return (
    <Block
      title={`${analysisTitle[data.analysis]} · ${data.scope}`}
      meta={data.analysis === "attribution" ? `${data.from} → ${data.to}` : undefined}
    >
      <RiskBody data={data} />
      {data.unpricedPositions.length ? (
        <Foot>Unpriced, excluded: {data.unpricedPositions.join(", ")}</Foot>
      ) : null}
    </Block>
  );
}

function RiskBody({ data }: { data: RiskOutput }) {
  switch (data.analysis) {
    case "factors":
      return (
        <>
          {data.groups.map((group) =>
            "error" in group ? (
              <Failure key={group.currency} {...group} />
            ) : (
              <div key={group.currency}>
                <table className="data-table chat-table">
                  <thead>
                    <tr>
                      <th>{group.currency} factor</th>
                      <th className="num">Beta</th>
                      <th className="num">t-stat</th>
                      <th className="num chat-col-wide">Ann. contrib</th>
                    </tr>
                  </thead>
                  <tbody>
                    {group.factors.map((factor) => (
                      <tr key={factor.factor}>
                        <td>{factor.label}</td>
                        <td className="num">{number(factor.beta)}</td>
                        <td
                          className={`num ${Math.abs(factor.tStat ?? 0) >= 2 ? "" : "muted"}`}
                        >
                          {number(factor.tStat)}
                        </td>
                        <td className="num chat-col-wide">
                          <Signed value={factor.annualContributionPercent} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <Foot>
                  α {percent(group.alphaAnnualPercent)}/yr (t {number(group.alphaTStat)}) · R²{" "}
                  {number(group.r2)} · {group.window.observations} days to {group.window.to}
                  {"caveat" in group && group.caveat ? " · US factors, indicative" : ""}
                </Foot>
              </div>
            ),
          )}
        </>
      );
    case "attribution":
      return (
        <>
          {data.groups.map((group) =>
            "error" in group ? (
              <Failure key={group.currency} {...group} />
            ) : (
              <div key={group.currency}>
                <table className="data-table chat-table">
                  <thead>
                    <tr>
                      <th>{group.currency}</th>
                      <th className="num chat-col-wide">Weight</th>
                      <th className="num">Return</th>
                      <th className="num">Contrib</th>
                      <th className="num chat-col-wide">Active</th>
                    </tr>
                  </thead>
                  <tbody>
                    {group.positions.map((row) => (
                      <tr key={row.symbol}>
                        <td>{row.symbol}</td>
                        <td className="num chat-col-wide muted">
                          {amount(row.startWeightPercent)}%
                        </td>
                        <td className="num">
                          <Signed value={row.returnPercent} />
                        </td>
                        <td className="num">
                          <Signed value={row.contributionPercent} />
                        </td>
                        <td className="num chat-col-wide">
                          <Signed value={row.activeContributionPercent} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <Foot>
                  Portfolio <Signed value={group.portfolioReturnPercent} /> vs {data.benchmark}{" "}
                  <Signed value={group.benchmarkReturnPercent} /> · active{" "}
                  <Signed value={group.activeReturnPercent} />
                </Foot>
              </div>
            ),
          )}
        </>
      );
    case "var":
      return (
        <>
          {data.groups.map((group) =>
            "error" in group ? (
              <Failure key={group.currency} {...group} />
            ) : (
              <div key={group.currency}>
                <table className="data-table chat-table">
                  <thead>
                    <tr>
                      <th>{group.currency}</th>
                      <th className="num">Hist VaR</th>
                      <th className="num">Hist ES</th>
                      <th className="num chat-col-wide">Param VaR</th>
                      <th className="num chat-col-wide">Param ES</th>
                    </tr>
                  </thead>
                  <tbody>
                    {group.measures.map((row) => (
                      <tr key={`${row.horizonDays}-${row.confidence}`}>
                        <td>
                          {row.horizonDays}d {row.confidence}%
                        </td>
                        <td className="num">
                          {amount(row.historicalVarPercent)}% · {compact(row.historicalVar)}
                        </td>
                        <td className="num">{amount(row.historicalEsPercent)}%</td>
                        <td className="num chat-col-wide muted">
                          {amount(row.parametricVarPercent)}%
                        </td>
                        <td className="num chat-col-wide muted">
                          {amount(row.parametricEsPercent)}%
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <Foot>
                  Vol {amount(group.annualVolPercent)}% · excess kurtosis{" "}
                  {number(group.excessKurtosis)} · {group.window.observations} days to{" "}
                  {group.window.to}
                </Foot>
              </div>
            ),
          )}
        </>
      );
    case "stress":
      return (
        <>
          {data.historical?.groups.map((group) =>
            "error" in group ? (
              <Failure key={group.currency} {...group} />
            ) : (
              <table key={group.currency} className="data-table chat-table">
                <thead>
                  <tr>
                    <th>{group.currency} scenario</th>
                    <th className="num">Portfolio</th>
                    <th className="num">P/L</th>
                    <th className="num chat-col-wide">{data.historical?.benchmark}</th>
                  </tr>
                </thead>
                <tbody>
                  {group.scenarios.map((scenario) => (
                    <tr key={scenario.key}>
                      <td className="chat-truncate" title={`${scenario.from} → ${scenario.to}`}>
                        {scenario.label}
                        {"proxiedPercentOfValue" in scenario &&
                        scenario.proxiedPercentOfValue ? (
                          <span className="tag chat-inline-tag">
                            {number(scenario.proxiedPercentOfValue)}% proxied
                          </span>
                        ) : null}
                      </td>
                      {"unavailable" in scenario ? (
                        <td className="num muted" colSpan={3}>
                          n/a
                        </td>
                      ) : (
                        <>
                          <td className="num">
                            <Signed value={scenario.portfolioReturnPercent} />
                          </td>
                          <td className="num">
                            <Money value={scenario.pnl} currency={group.currency} />
                          </td>
                          <td className="num chat-col-wide">
                            <Signed value={scenario.benchmarkReturnPercent} />
                          </td>
                        </>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            ),
          )}
          {data.shocks?.groups.map((group) =>
            "error" in group ? (
              <Failure key={group.currency} {...group} />
            ) : (
              <table key={group.currency} className="data-table chat-table">
                <thead>
                  <tr>
                    <th>{group.currency} shock</th>
                    <th className="num">P/L</th>
                    <th className="num">Portfolio</th>
                  </tr>
                </thead>
                <tbody>
                  {group.shocks.map((shock) => (
                    <tr key={`${shock.driver}-${shock.size}`}>
                      <td>
                        {shock.label} {shock.size > 0 ? "+" : ""}
                        {shock.size}
                        {shock.unit === "%" ? "%" : ` ${shock.unit}`}
                      </td>
                      {"unavailable" in shock ? (
                        <td className="num muted" colSpan={2}>
                          n/a
                        </td>
                      ) : (
                        <>
                          <td className="num">
                            <Money value={shock.pnl} currency={group.currency} />
                          </td>
                          <td className="num">
                            <Signed value={shock.portfolioReturnPercent} />
                          </td>
                        </>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            ),
          )}
        </>
      );
  }
}

type Insider = Success<"getInsiderBuying">;

export function InsiderBuyingView({ data }: { data: Insider }) {
  const [rows, setRows] = useState(false);
  const clusters = data.clusters.slice(0, 12);
  return (
    <Block
      title={`Insider buying · ${data.scope}`}
      meta={`${data.from} → ${data.to}`}
    >
      {clusters.length ? (
        <table className="data-table chat-table">
          <thead>
            <tr>
              <th>Issuer</th>
              <th className="num">Buyers</th>
              <th className="num">Value</th>
              <th className="num chat-col-wide">Avg price</th>
              <th className="num chat-col-wide">Dates</th>
            </tr>
          </thead>
          <tbody>
            {clusters.map((cluster) => (
              <tr key={cluster.url}>
                <td
                  className="chat-truncate"
                  title={cluster.buyers
                    .map((buyer) => `${buyer.name} (${buyer.role})`)
                    .join("; ")}
                >
                  <a href={cluster.url} target="_blank" rel="noopener noreferrer">
                    {cluster.symbol ?? cluster.issuer}
                  </a>
                </td>
                <td className="num">{cluster.insiders}</td>
                <td className="num">${compact(cluster.totalValue)}</td>
                <td className="num chat-col-wide muted">{amount(cluster.averagePrice)}</td>
                <td className="num chat-col-wide muted">
                  {cluster.firstDate.slice(5)} – {cluster.lastDate.slice(5)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <Foot>
          No cluster of {data.minInsiders}+ insiders within {data.windowDays} days.
        </Foot>
      )}
      {rows ? (
        <table className="data-table chat-table">
          <thead>
            <tr>
              <th>Largest purchases</th>
              <th>Insider</th>
              <th className="num">Value</th>
              <th className="num chat-col-wide">Price</th>
            </tr>
          </thead>
          <tbody>
            {data.largestPurchases.map((row) => (
              <tr key={`${row.url}-${row.insider}-${row.date}-${row.shares}`}>
                <td>{row.symbol ?? row.issuer}</td>
                <td className="chat-truncate" title={row.role}>
                  {row.insider}
                </td>
                <td className="num">${compact(row.value)}</td>
                <td className="num chat-col-wide muted">{amount(row.price)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
      <div className="chat-tool-foot">
        <span>
          {data.purchaseCount} buys · ${compact(data.totalValue)} · {data.parsedFilings}/
          {data.candidateFilings} filings read
          {data.partial ? " · partial" : ""}
        </span>
        {!rows && data.largestPurchases.length ? (
          <button type="button" className="chat-more" onClick={() => setRows(true)}>
            Show largest buys
          </button>
        ) : null}
      </div>
    </Block>
  );
}

type Activist = Success<"getActivistStakes">;

export function ActivistStakesView({ data }: { data: Activist }) {
  return (
    <Block
      title={`13D / 13G stakes · ${data.scope}`}
      meta={`${data.from} → ${data.to}`}
    >
      {data.stakes.length ? (
        <table className="data-table chat-table">
          <thead>
            <tr>
              <th>Subject</th>
              <th className="chat-col-wide">Filer</th>
              <th className="num">% class</th>
              <th className="num">Filed</th>
            </tr>
          </thead>
          <tbody>
            {data.stakes.slice(0, 15).map((stake) => (
              <tr key={stake.url}>
                <td className="chat-truncate" title={stake.subject ?? undefined}>
                  <a href={stake.url} target="_blank" rel="noopener noreferrer">
                    {stake.symbol ?? stake.subject ?? "—"}
                  </a>
                  <span className="tag chat-inline-tag">
                    {stake.form.replace("SCHEDULE ", "").replace("SC ", "")}
                  </span>
                </td>
                <td className="chat-truncate chat-col-wide" title={stake.filer ?? undefined}>
                  {stake.filer ?? "—"}
                  {stake.otherFilers ? ` +${stake.otherFilers}` : ""}
                </td>
                <td className="num">
                  {stake.percentOfClass == null ? "—" : `${number(stake.percentOfClass)}%`}
                </td>
                <td className="num muted">{stake.filed.slice(5)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <Foot>No matching filings in the window.</Foot>
      )}
      <Foot>
        {data.matched} filings
        {data.stakes.length > 15 ? ` · showing 15` : ""}
        {data.partial ? " · partial" : ""}
      </Foot>
    </Block>
  );
}
