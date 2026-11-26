"use client";

import { useEffect, useState } from "react";

const answers = [
  {
    question: "What % of the S&P 500 is above its 50-day average?",
    tool: "compute · 503 price histories · 14.5 s",
    figure: "59.3%",
    detail: "297 of 501 members trade above their 50-day moving average.",
    source: "Market data · 25 Nov 2026",
  },
  {
    question: "What is the options market pricing for Apple's earnings?",
    tool: "getOptions · ATM IV 26.4% · 23 expiries",
    figure: "±7.6%",
    detail:
      "Move implied into the 28 January 2027 report, isolated from ordinary trading days.",
    source: "Options chain · 26 Nov 2026",
  },
  {
    question: "Any cluster insider buying in the S&P 500 this month?",
    tool: "getInsiderBuying · 155 Form 4 filings read",
    figure: "COHR",
    detail:
      "Three insiders, $51.1M in open-market purchases. Boeing and Eaton also show clusters.",
    source: "SEC EDGAR · 27 Oct – 26 Nov 2026",
  },
  {
    question: "How would my book have done in the Covid crash?",
    tool: "getPortfolioRisk · stress · historical replay",
    figure: "−34.5%",
    detail: "Against −33.9% for the S&P 500, 19 February to 23 March 2020.",
    source: "Your holdings · daily closes",
  },
  {
    question: "Where is the Treasury curve today?",
    tool: "getYieldCurve · 1M to 30Y",
    figure: "4.85%",
    detail: "Ten-year par yield. Two-year 4.61%, thirty-year 5.24%.",
    source: "U.S. Treasury · 25 Nov 2026",
  },
  {
    question: "What does Microsoft list as its main risks?",
    tool: "readFiling · 10-K · Item 1A",
    figure: "Item 1A",
    detail:
      "Risk factors read section by section, quoted with the form and filing date.",
    source: "MSFT 10-K · filed 29 Jul 2026",
  },
] as const;

const cycle = 6500;

export function AskDemo() {
  const [active, setActive] = useState(0);
  const [paused, setPaused] = useState(false);
  const [still, setStill] = useState(false);

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setStill(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    if (paused || still) return;
    const timer = window.setTimeout(
      () => setActive((index) => (index + 1) % answers.length),
      cycle,
    );
    return () => window.clearTimeout(timer);
  }, [active, paused, still]);

  const answer = answers[active];
  return (
    <div
      className="ask-demo"
      data-paused={paused || still}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      <ol className="ask-list">
        {answers.map((item, index) => (
          <li key={item.question}>
            <button
              type="button"
              aria-pressed={index === active}
              onClick={() => setActive(index)}
            >
              {item.question}
              {index === active ? (
                <span
                  className="ask-progress"
                  style={{ animationDuration: `${cycle}ms` }}
                  aria-hidden
                />
              ) : null}
            </button>
          </li>
        ))}
      </ol>
      <div className="ask-panel" aria-live="polite" key={active}>
        <p className="ask-question">
          <span className="ask-typed">{answer.question}</span>
        </p>
        <p className="ask-tool">{answer.tool}</p>
        <p className="ask-figure">{answer.figure}</p>
        <p className="ask-detail">{answer.detail}</p>
        <p className="ask-source">{answer.source}</p>
      </div>
    </div>
  );
}
