"use client";

import { useEffect, useState } from "react";
import useSWR from "swr";
import { ExternalLink } from "lucide-react";
import { api, Empty, Failure, Loading } from "@/components/shared";
import { useQuotes } from "@/components/market-widgets";
import type {
  Candidate,
  Link,
  OwnDisclosure,
  Verified,
} from "@/lib/supply-chain-types";
import { amount, percent, tone } from "@/lib/utils";
import type { SecurityFunction } from "@/lib/terminal";
import { downloadCsv } from "@/lib/export";
import { SupplyGraph } from "./supply-graph";

type Check = { state: "pending" | "done" | "failed"; link: Link | null };
const CONCURRENCY = 3;

function useVerifications(ticker: string, list: Candidate[] | undefined) {
  const key = list?.map((item) => item.cik).join(",") ?? "";
  const [results, setResults] = useState<{
    key: string;
    checks: Record<string, Check>;
  }>({ key: "", checks: {} });
  useEffect(() => {
    if (!key) return;
    const ciks = key.split(",");
    const controller = new AbortController();
    let cursor = 0;
    const record = (cik: string, check: Check) =>
      setResults((current) => ({
        key,
        checks: { ...(current.key === key ? current.checks : {}), [cik]: check },
      }));
    async function worker() {
      while (cursor < ciks.length && !controller.signal.aborted) {
        const cik = ciks[cursor++];
        try {
          const result = await api<Verified>(
            `/api/supply-chain?${new URLSearchParams({ symbol: ticker, part: "verify", cik })}`,
            { signal: controller.signal },
          );
          record(cik, { state: "done", link: result.link });
        } catch {
          if (!controller.signal.aborted)
            record(cik, { state: "failed", link: null });
        }
      }
    }
    void Promise.all(Array.from({ length: CONCURRENCY }, worker));
    return () => controller.abort();
  }, [ticker, key]);
  if (!key) return {};
  const done = results.key === key ? results.checks : {};
  return Object.fromEntries(
    key
      .split(",")
      .map((cik): [string, Check] => [
        cik,
        done[cik] ?? { state: "pending", link: null },
      ]),
  );
}

const filingLabel = (link: Link) =>
  `${link.source.ticker ?? link.source.name} ${link.source.form} · ${link.source.filed.slice(0, 7)}`;

function LinkCard({
  link,
  company,
  select,
  change,
}: {
  link: Link;
  company: string;
  select: (symbol: string) => void;
  change: number | null | undefined;
}) {
  const shareText =
    link.share == null
      ? null
      : link.shareOf === "company"
        ? `${amount(link.share * 100)}% of ${company} revenue`
        : `${amount(link.share * 100)}% of its revenue from ${company}`;
  return (
    <li className="splc-card" data-role={link.role} data-tone={tone(change)}>
      <div className="splc-head">
        {link.ticker ? (
          <button
            type="button"
            className="security-link"
            onClick={() => link.ticker && select(link.ticker)}
          >
            {link.ticker}
          </button>
        ) : null}
        <strong>{link.counterparty}</strong>
        {change != null ? (
          <span className={tone(change)}>{percent(change)}</span>
        ) : null}
      </div>
      {shareText ? <p className="splc-share">{shareText}</p> : null}
      <details>
        <summary>
          {filingLabel(link)}
          {link.period ? ` · ${link.period}` : ""}
        </summary>
        <blockquote>“{link.quote}”</blockquote>
        <a href={link.source.url} target="_blank" rel="noreferrer">
          Open filing <ExternalLink size={11} aria-hidden />
        </a>
      </details>
    </li>
  );
}

const modes = [
  ["graph", "Graph"],
  ["cards", "Columns"],
  ["table", "Table"],
] as const;
type Mode = (typeof modes)[number][0];
const MODE_KEY = "stockwatcher.splc.mode";

export function SupplyChain({
  ticker,
  select,
  openFunction,
}: {
  ticker: string;
  select: (symbol: string) => void;
  openFunction?: (symbol: string, fn: SecurityFunction) => void;
}) {
  const [mode, setModeState] = useState<Mode>(() => {
    try {
      const stored = localStorage.getItem(MODE_KEY);
      return modes.find(([key]) => key === stored)?.[0] ?? "graph";
    } catch {
      return "graph";
    }
  });
  const setMode = (next: Mode) => {
    setModeState(next);
    try {
      localStorage.setItem(MODE_KEY, next);
    } catch {}
  };
  const own = useSWR<OwnDisclosure>(
    `/api/supply-chain?${new URLSearchParams({ symbol: ticker, part: "own" })}`,
    api,
    { revalidateOnFocus: false, errorRetryCount: 0 },
  );
  const list = useSWR<Candidate[]>(
    `/api/supply-chain?${new URLSearchParams({ symbol: ticker, part: "candidates" })}`,
    api,
    { revalidateOnFocus: false, errorRetryCount: 1 },
  );
  const checks = useVerifications(ticker, own.error ? undefined : list.data);
  const verified = Object.values(checks).flatMap((check) =>
    check.link ? [check.link] : [],
  );
  const links = [...(own.data?.links ?? []), ...verified];
  const unique = new Map<string, Link>();
  for (const link of links) {
    const key = `${link.role}:${link.ticker ?? link.counterparty.toLowerCase()}`;
    const prior = unique.get(key);
    if (!prior || (prior.share == null && link.share != null)) unique.set(key, link);
  }
  const all = [...unique.values()].sort(
    (a, b) => (b.share ?? -1) - (a.share ?? -1),
  );
  const symbols = all.flatMap((link) => (link.ticker ? [link.ticker] : []));
  const { data: quotes } = useQuotes([ticker, ...symbols], true);
  const move = new Map(quotes?.quotes.map((quote) => [quote.symbol, quote.percent]));
  const self = quotes?.quotes.find((quote) => quote.symbol === ticker);
  const company = own.data?.filing.name ?? ticker;
  const pending = Object.values(checks).filter(
    (check) => check.state === "pending",
  ).length;
  const unconfirmed = (list.data ?? []).filter((item) => {
    const check = checks[item.cik];
    return check?.state === "done" && !check.link;
  });
  const column = (roles: Link["role"][]) =>
    all.filter((link) => roles.includes(link.role));
  const suppliers = column(["supplier"]);
  const customers = column(["customer"]);
  const others = column(["partner", "competitor"]);
  const card = (link: Link) => (
    <LinkCard
      key={`${link.role}-${link.counterparty}`}
      link={link}
      company={company}
      select={select}
      change={link.ticker ? move.get(link.ticker) : null}
    />
  );

  if (own.error && list.error)
    return <Failure error={own.error} retry={() => void own.mutate()} />;
  return (
    <div className="splc">
      {own.error ? <Failure error={own.error} /> : null}
      <p className="term-source splc-status" role="status">
        {own.isLoading
          ? `Reading ${ticker}'s latest annual report…`
          : own.data
            ? `${own.data.filing.form} filed ${own.data.filing.filed}: ${own.data.links.length} disclosed relationships`
            : ""}
        {list.data
          ? ` · ${list.data.length} other filers name ${ticker} near customer/supplier language${pending ? `, checking ${pending}…` : ""}`
          : list.isLoading
            ? " · searching other filings…"
            : ""}
      </p>
      <div className="term-toolbar">
        <div className="seg" role="group" aria-label="Supply chain view">
          {modes.map(([key, label]) => (
            <button
              key={key}
              type="button"
              aria-pressed={mode === key}
              onClick={() => setMode(key)}
            >
              {label}
            </button>
          ))}
        </div>
        {all.length ? (
          <button
            type="button"
            className="chip"
            onClick={() =>
              downloadCsv(
                all.map((link) => ({
                  counterparty: link.counterparty,
                  ticker: link.ticker ?? "",
                  role: link.role,
                  share: link.share,
                  shareOf: link.shareOf,
                  period: link.period ?? "",
                  filing: `${link.source.name} ${link.source.form} ${link.source.filed}`,
                  url: link.source.url,
                  quote: link.quote,
                })),
                `${ticker}-relationships`,
              )
            }
          >
            Export CSV
          </button>
        ) : null}
      </div>
      {mode === "graph" ? (
        <SupplyGraph
          key={ticker}
          ticker={ticker}
          company={company}
          links={all}
          loading={own.isLoading || pending > 0}
          select={select}
          openFunction={openFunction}
        />
      ) : null}
      {mode === "table" ? (
        <div className="desk-table-wrap term-table-wrap">
          <table className="data-table term-table">
            <thead>
              <tr>
                <th>Counterparty</th>
                <th>Ticker</th>
                <th>Role</th>
                <th className="num">Share</th>
                <th className="num">Day</th>
                <th>Period</th>
                <th>Source</th>
              </tr>
            </thead>
            <tbody>
              {all.map((link) => (
                <tr key={`${link.role}-${link.counterparty}`} data-role={link.role}>
                  <td>{link.counterparty}</td>
                  <td>
                    {link.ticker ? (
                      <button
                        type="button"
                        className="security-link"
                        onClick={() => link.ticker && select(link.ticker)}
                      >
                        {link.ticker}
                      </button>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="splc-role">{link.role}</td>
                  <td className="num">
                    {link.share == null
                      ? "—"
                      : `${amount(link.share * 100)}%${link.shareOf === "counterparty" ? "*" : ""}`}
                  </td>
                  <td className={`num ${tone(link.ticker ? move.get(link.ticker) : null)}`}>
                    {link.ticker ? percent(move.get(link.ticker)) : "—"}
                  </td>
                  <td>{link.period ?? "—"}</td>
                  <td>
                    <a href={link.source.url} target="_blank" rel="noreferrer" title={link.quote}>
                      {filingLabel(link)}
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="term-source">
            * share of the counterparty&apos;s revenue rather than {ticker}&apos;s.
          </p>
        </div>
      ) : null}
      {mode === "cards" ? (
      <div className="splc-grid">
        <section aria-label="Suppliers">
          <h3>Suppliers · sell to {ticker}</h3>
          {suppliers.length ? (
            <ul>{suppliers.map(card)}</ul>
          ) : (
            <Empty title={pending || own.isLoading ? "Checking…" : "None disclosed"} />
          )}
        </section>
        <section className="splc-center" aria-label={company}>
          <div className="splc-self" data-tone={tone(self?.percent)}>
            <strong>{ticker}</strong>
            <span>{company}</span>
            {self ? (
              <span>
                {amount(self.price)} {percent(self.percent)}
              </span>
            ) : null}
          </div>
          {others.length ? (
            <>
              <h3>Partners & competitors</h3>
              <ul>{others.map(card)}</ul>
            </>
          ) : null}
        </section>
        <section aria-label="Customers">
          <h3>Customers · buy from {ticker}</h3>
          {customers.length ? (
            <ul>{customers.map(card)}</ul>
          ) : own.isLoading || pending ? (
            <Loading message="Reading filings" />
          ) : (
            <Empty title="None disclosed" />
          )}
        </section>
      </div>
      ) : null}
      {unconfirmed.length ? (
        <details className="splc-unconfirmed">
          <summary>
            {unconfirmed.length} filers mention {ticker} without a stated
            commercial relationship
          </summary>
          <ul>
            {unconfirmed.map((item) => (
              <li key={item.cik}>
                {item.ticker ? (
                  <button
                    type="button"
                    className="security-link"
                    onClick={() => item.ticker && select(item.ticker)}
                  >
                    {item.ticker}
                  </button>
                ) : null}{" "}
                {item.name}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
      <p className="term-source">
        Built from SEC filings: the company&apos;s own annual report plus other
        filers that name it. Every link is backed by a sentence quoted verbatim
        from the filing; a model extracts them and quotes that don&apos;t match
        the filing text are dropped. Companies disclose customers mainly above
        10% of revenue, so large companies show few customers.
      </p>
    </div>
  );
}
