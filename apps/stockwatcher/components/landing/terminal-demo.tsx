"use client";

import { type FormEvent, type ReactNode, useRef, useState } from "react";
import { useMotion } from "@/components/marketing/motion";
import {
  monitorFunctions,
  overlayFunction,
  securityFunctions,
  workspaceFunctions,
} from "@/lib/terminal";
import { curve, des, ern, most, prsk, signed, wire } from "./terminal-data";

const allFunctions = [
  ...securityFunctions,
  ...monitorFunctions,
  overlayFunction,
  ...workspaceFunctions,
];

const chips = [
  "AAPL DES",
  "AAPL ERN",
  "GC",
  "PRSK",
  "MOST",
  "NEWS",
  "HELP",
] as const;
type Known = (typeof chips)[number];
const tour: Known[] = ["AAPL DES", "AAPL ERN", "GC"];

type Result =
  | { kind: "known"; command: Known }
  | { kind: "elsewhere"; code: string }
  | { kind: "needs-ticker"; code: string }
  | { kind: "unknown"; input: string };

function resolve(raw: string): Result {
  const input = raw
    .toUpperCase()
    .replace(/<GO>/g, "")
    .replace(/\bUS EQUITY\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (input === "?" || input === "HELP")
    return { kind: "known", command: "HELP" };
  if (input === "NEWS" || input === "TOP" || input === "N")
    return { kind: "known", command: "NEWS" };
  if (input === "GC" || input === "MOST" || input === "PRSK")
    return { kind: "known", command: input };
  const [first, second] = input.split(" ");
  if (second && (input === "AAPL DES" || input === "AAPL ERN"))
    return { kind: "known", command: input };
  const code = second ?? first ?? "";
  const known = allFunctions.some((item) => item.code === code);
  if (!second && securityFunctions.some((item) => item.code === code))
    return { kind: "needs-ticker", code };
  if (known) return { kind: "elsewhere", code };
  return { kind: "unknown", input };
}

const money = (value: number) =>
  value.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="term-row">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

function Tone({ value, children }: { value: number; children: ReactNode }) {
  return <span data-sign={value >= 0 ? "up" : "down"}>{children}</span>;
}

function Des() {
  const change = des.last - des.previous;
  const percent = (change / des.previous) * 100;
  return (
    <>
      <p className="term-title">
        AAPL US Equity <span>DES · Description</span>
      </p>
      <p className="term-name">
        {des.name} <span>{des.exchange} · USD</span>
      </p>
      <p className="term-price">
        <strong>{money(des.last)}</strong>
        <Tone value={change}>
          {signed(change)} {signed(percent)}%
        </Tone>
      </p>
      <dl className="term-grid">
        <Row label="Day range">
          {money(des.dayLow)} – {money(des.dayHigh)}
        </Row>
        <Row label="52-week">
          {money(des.yearLow)} – {money(des.yearHigh)}
        </Row>
        <Row label="Volume">{(des.volume / 1e6).toFixed(2)}M</Row>
        <Row label="Sector">Technology · Consumer Electronics</Row>
        <Row label="Fiscal year">Ends late September</Row>
        <Row label="Next report">{ern.report}</Row>
      </dl>
      <p className="term-source">Yahoo Finance · SEC EDGAR · {des.asOf}</p>
    </>
  );
}

function Ern() {
  const dollars = (ern.reference * ern.impliedMove) / 100;
  return (
    <>
      <p className="term-title">
        AAPL US Equity <span>ERN · Earnings</span>
      </p>
      <p className="term-figure">
        <strong>±{ern.impliedMove.toFixed(2)}%</strong>
        <span>implied move into the {ern.report} report</span>
      </p>
      <dl className="term-grid">
        <Row label="In dollars">
          ±{money(dollars)} on a {money(ern.reference)} close
        </Row>
        <Row label="Range priced">
          {money(ern.reference - dollars)} – {money(ern.reference + dollars)}
        </Row>
        <Row label="ATM IV">{ern.atmIv.toFixed(1)}%</Row>
        <Row label="Expiries read">{ern.expiries}</Row>
      </dl>
      <p className="term-note">
        Event move isolated from ordinary trading days using the expiries either
        side of the report.
      </p>
      <p className="term-source">Options chain · {ern.asOf}</p>
    </>
  );
}

const chart = { width: 560, height: 190, pad: 30, low: 3.2, high: 5.5 };
const xAt = (index: number) =>
  chart.pad +
  (index * (chart.width - chart.pad * 2)) / Math.max(1, curve.length - 1);
const yAt = (value: number) =>
  chart.height -
  chart.pad / 1.5 -
  ((value - chart.low) / (chart.high - chart.low)) *
    (chart.height - chart.pad * 1.4);
const line = (key: "today" | "yearAgo") =>
  curve
    .map(
      (point, index) =>
        `${index ? "L" : "M"}${xAt(index).toFixed(1)} ${yAt(point[key]).toFixed(1)}`,
    )
    .join("");

function Gc() {
  const tenYear = curve.find((point) => point.tenor === "10Y");
  const twoYear = curve.find((point) => point.tenor === "2Y");
  const spread = (key: "today" | "yearAgo") =>
    tenYear && twoYear ? Math.round((tenYear[key] - twoYear[key]) * 100) : 0;
  return (
    <>
      <p className="term-title">
        US Treasury curve <span>GC · Yield curve</span>
      </p>
      <figure className="term-curve">
        <svg
          viewBox={`0 0 ${chart.width} ${chart.height}`}
          role="img"
          aria-label={`Par yields from 1 month to 30 years. Ten-year ${tenYear?.today}% against ${tenYear?.yearAgo}% a year earlier.`}
        >
          {[3.5, 4, 4.5, 5].map((level) => (
            <g key={level}>
              <line
                className="term-axis"
                x1={chart.pad}
                x2={chart.width - chart.pad}
                y1={yAt(level)}
                y2={yAt(level)}
              />
              <text x={0} y={yAt(level) + 4}>
                {level.toFixed(1)}
              </text>
            </g>
          ))}
          {curve.map((point, index) => (
            <text
              key={point.tenor}
              x={xAt(index)}
              y={chart.height - 2}
              textAnchor="middle"
            >
              {point.tenor}
            </text>
          ))}
          <path
            className="term-plot term-plot-prior"
            d={line("yearAgo")}
            pathLength={1}
          />
          <path className="term-plot" d={line("today")} pathLength={1} />
        </svg>
        <figcaption>
          <span className="term-key">25 Nov 2026</span>
          <span className="term-key term-key-prior">25 Nov 2025</span>
          <span>
            2s10s {spread("today")}bp, from {spread("yearAgo")}bp
          </span>
        </figcaption>
      </figure>
      <table className="term-table">
        <thead>
          <tr>
            <th>Tenor</th>
            <th>Today</th>
            <th>1Y ago</th>
            <th>Chg bp</th>
          </tr>
        </thead>
        <tbody>
          {curve.map((point) => {
            const bp = Math.round((point.today - point.yearAgo) * 100);
            return (
              <tr key={point.tenor}>
                <td>{point.tenor}</td>
                <td>{point.today.toFixed(2)}</td>
                <td>{point.yearAgo.toFixed(2)}</td>
                <td>
                  <Tone value={bp}>{signed(bp, 0)}</Tone>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="term-source">U.S. Treasury · daily par yield curve</p>
    </>
  );
}

function Prsk() {
  const scale = 40;
  return (
    <>
      <p className="term-title">
        Sample portfolio <span>PRSK · Portfolio risk</span>
      </p>
      <p className="term-name">
        Historical replay: {prsk.scenario} <span>{prsk.window}</span>
      </p>
      <dl className="term-bars">
        {[
          ["Portfolio", prsk.portfolio],
          ["S&P 500", prsk.benchmark],
        ].map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>
              <span
                className="term-meter"
                style={{ width: `${(Math.abs(Number(value)) / scale) * 100}%` }}
              />
              <Tone value={Number(value)}>{signed(Number(value))}%</Tone>
            </dd>
          </div>
        ))}
      </dl>
      <dl className="term-grid">
        <Row label="Against index">
          <Tone value={prsk.portfolio - prsk.benchmark}>
            {signed(prsk.portfolio - prsk.benchmark)} pt
          </Tone>
        </Row>
        <Row label="Method">Today’s weights on 2020 daily closes</Row>
      </dl>
      <p className="term-source">
        Sample holdings · daily closes · hypothetical
      </p>
    </>
  );
}

function Most() {
  return (
    <>
      <p className="term-title">
        US equities <span>MOST · Most active</span>
      </p>
      <table className="term-table term-table-wide">
        <thead>
          <tr>
            <th>Symbol</th>
            <th className="term-hide-narrow">Name</th>
            <th>Last</th>
            <th>Chg %</th>
            <th>Vol</th>
          </tr>
        </thead>
        <tbody>
          {most.map((row) => (
            <tr key={row.symbol}>
              <td>{row.symbol}</td>
              <td className="term-hide-narrow">{row.name}</td>
              <td>{money(row.last)}</td>
              <td>
                <Tone value={row.change}>{signed(row.change)}</Tone>
              </td>
              <td>{row.volume.toFixed(1)}M</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="term-source">
        Yahoo Finance US screener · close 25 Nov 2026
      </p>
    </>
  );
}

function News() {
  return (
    <>
      <p className="term-title">
        Wire <span>TOP · News wire</span>
      </p>
      <ol className="term-news">
        {wire.slice(0, 6).map((item) => (
          <li key={item.title}>
            <span className="term-time">{item.time}</span>
            <span>{item.title}</span>
            <span className="term-meta">
              {item.publisher} · {item.symbols}
            </span>
          </li>
        ))}
      </ol>
      <p className="term-source">Times UTC · publishers as credited</p>
    </>
  );
}

function Help() {
  return (
    <>
      <p className="term-title">
        {allFunctions.length} functions <span>HELP</span>
      </p>
      <p className="term-note">
        This preview runs AAPL DES, AAPL ERN, GC, PRSK, MOST and NEWS. The app
        runs all of them on any ticker.
      </p>
      <ul className="term-help">
        {allFunctions.map((item) => (
          <li key={item.code}>
            <strong>{item.code}</strong> {item.label}
          </li>
        ))}
      </ul>
    </>
  );
}

function Output({ result }: { result: Result }) {
  if (result.kind === "known") {
    switch (result.command) {
      case "AAPL DES":
        return <Des />;
      case "AAPL ERN":
        return <Ern />;
      case "GC":
        return <Gc />;
      case "PRSK":
        return <Prsk />;
      case "MOST":
        return <Most />;
      case "NEWS":
        return <News />;
      case "HELP":
        return <Help />;
    }
  }
  if (result.kind === "needs-ticker")
    return (
      <p className="term-note">
        {result.code} needs a security first. Try AAPL {result.code}.
      </p>
    );
  if (result.kind === "elsewhere")
    return (
      <p className="term-note">
        {result.code} is one of the {allFunctions.length} functions in the app.
        This preview runs DES, ERN, GC, PRSK, MOST and NEWS.
      </p>
    );
  return (
    <p className="term-note">
      Unknown command “{result.input}”. Type HELP for the list.
    </p>
  );
}

export function TerminalDemo() {
  const section = useRef<HTMLElement>(null);
  const timers = useRef<number[]>([]);
  const touched = useRef(false);
  const instant = useRef(false);
  const [value, setValue] = useState("");
  const [run, setRun] = useState<{ id: number; result: Result; input: string }>(
    {
      id: 0,
      result: { kind: "known", command: "AAPL DES" },
      input: "AAPL DES",
    },
  );

  const clear = () => {
    for (const timer of timers.current) window.clearTimeout(timer);
    timers.current = [];
  };

  const execute = (input: string) => {
    clear();
    setValue("");
    setRun((current) => ({
      id: current.id + 1,
      result: resolve(input),
      input,
    }));
  };

  const type = (command: string) => {
    clear();
    if (instant.current) {
      execute(command);
      return;
    }
    setValue("");
    [...command].forEach((_, index) => {
      timers.current.push(
        window.setTimeout(
          () => setValue(command.slice(0, index + 1)),
          45 * (index + 1),
        ),
      );
    });
    timers.current.push(
      window.setTimeout(() => execute(command), 45 * command.length + 220),
    );
  };

  useMotion(section, ({ motion, wide }, { ScrollTrigger }) => {
    const root = section.current;
    instant.current = !motion;
    if (!root || !motion) return;
    if (wide) {
      let shown = -1;
      ScrollTrigger.create({
        trigger: root,
        start: "top top",
        end: "+=150%",
        pin: true,
        onUpdate: (self) => {
          if (touched.current) return;
          const index = Math.min(
            tour.length - 1,
            Math.floor(self.progress * tour.length),
          );
          if (index === shown) return;
          shown = index;
          type(tour[index]);
        },
      });
    } else {
      ScrollTrigger.create({
        trigger: root,
        start: "top 65%",
        once: true,
        onEnter: () => {
          if (!touched.current) type("AAPL DES");
        },
      });
    }
    return clear;
  });

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    touched.current = true;
    const input = value.trim();
    if (input) execute(input);
  };

  return (
    <section
      ref={section}
      id="terminal"
      className="mk-section terminal-section"
      data-tone="night"
      aria-labelledby="terminal-title"
    >
      <div className="mk-split">
        <header className="mk-head">
          <h2 id="terminal-title">The terminal, without the terminal seat.</h2>
          <p>
            {allFunctions.length} functions on any ticker: description,
            earnings, holders, the yield curve, portfolio risk. Type one.
          </p>
        </header>
        <div className="term-wrap">
          <div className="term">
            <div className="term-bar" aria-hidden>
              <span>STOCKWATCHER</span>
              <span>{run.input.toUpperCase()}</span>
              <span>25 NOV 2026 16:00 ET</span>
            </div>
            <form className="term-line" onSubmit={submit}>
              <label htmlFor="term-input" className="sr-only">
                Terminal command
              </label>
              <span aria-hidden>&gt;</span>
              <input
                id="term-input"
                value={value}
                onChange={(event) => {
                  touched.current = true;
                  clear();
                  setValue(event.target.value);
                }}
                placeholder="AAPL ERN"
                autoComplete="off"
                autoCapitalize="characters"
                spellCheck={false}
                enterKeyHint="go"
                maxLength={40}
              />
              <button type="submit">GO</button>
            </form>
            <div
              className="term-out"
              key={run.id}
              aria-live="polite"
              aria-label={`Output for ${run.input}`}
            >
              <Output result={run.result} />
            </div>
          </div>
          <ul className="term-chips" aria-label="Try a command">
            {chips.map((chip) => (
              <li key={chip}>
                <button
                  type="button"
                  aria-pressed={run.input === chip}
                  onClick={() => {
                    touched.current = true;
                    type(chip);
                  }}
                >
                  {chip}
                </button>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
