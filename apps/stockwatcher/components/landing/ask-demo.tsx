"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import { useMotion } from "@/components/marketing/motion";

type Segment = string | { strong: string } | { cite: number };
type Source = { label: string; time: string };
type Answer = {
  question: string;
  tool: string;
  answer: Segment[];
  sources: Source[];
};

const answers: Answer[] = [
  {
    question: "What share of the S&P 500 is above its 50-day average?",
    tool: "compute · 503 price histories · 14.5 s",
    answer: [
      { strong: "59.3%" },
      " of the index trades above its 50-day moving average",
      { cite: 1 },
      ": 297 of 501 members with 50 sessions of history",
      { cite: 1 },
      ". The calculation ran over 503 daily price histories",
      { cite: 2 },
      ".",
    ],
    sources: [
      { label: "Market data · daily closes", time: "25 Nov 2026, 21:00 UTC" },
      { label: "Stockwatcher compute · 14.5 s run", time: "25 Nov 2026" },
    ],
  },
  {
    question: "What does Microsoft list as its main risks?",
    tool: "readFiling · 10-K · Item 1A",
    answer: [
      "Microsoft groups its risk factors under ",
      { strong: "Item 1A" },
      " of its 10-K",
      { cite: 1 },
      ". Strategic and competitive risks come first, including competition across its markets and the execution risk of its cloud and AI investments",
      { cite: 1 },
      ". Cybersecurity, data privacy and platform abuse follow",
      { cite: 2 },
      ", then legal, regulatory and litigation risk",
      { cite: 3 },
      ".",
    ],
    sources: [
      {
        label: "MSFT 10-K · Item 1A · Strategic and Competitive Risks",
        time: "Filed 29 Jul 2026",
      },
      {
        label:
          "MSFT 10-K · Item 1A · Cybersecurity, Data Privacy, and Platform Abuse Risks",
        time: "Filed 29 Jul 2026",
      },
      {
        label: "MSFT 10-K · Item 1A · Legal, Regulatory, and Litigation Risks",
        time: "Filed 29 Jul 2026",
      },
    ],
  },
  {
    question: "Any cluster insider buying in the S&P 500 this month?",
    tool: "getInsiderBuying · 155 Form 4 filings read",
    answer: [
      "Coherent leads: three insiders bought ",
      { strong: "$51.09M" },
      " in the open market",
      { cite: 1 },
      ". Boeing and Eaton also show clusters",
      { cite: 2 },
      ". 155 Form 4 filings were read across the index",
      { cite: 3 },
      ".",
    ],
    sources: [
      { label: "SEC EDGAR · Form 4 · COHR", time: "27 Oct – 26 Nov 2026" },
      { label: "SEC EDGAR · Form 4 · BA, ETN", time: "27 Oct – 26 Nov 2026" },
      { label: "getInsiderBuying · S&P 500 members", time: "26 Nov 2026" },
    ],
  },
  {
    question: "How much market risk is my book really carrying?",
    tool: "getPortfolioRisk · factors · Fama-French 5 + momentum",
    answer: [
      "Market beta is ",
      { strong: "1.15" },
      { cite: 1 },
      ": the book moves about 1.15% for each 1% in the market, after size, value, profitability, investment and momentum are accounted for",
      { cite: 2 },
      ". The factor data lag one to two months",
      { cite: 2 },
      ".",
    ],
    sources: [
      { label: "Your holdings · daily adjusted closes", time: "25 Nov 2026" },
      {
        label: "Kenneth R. French Data Library · US factors",
        time: "Daily series · lags 1–2 months",
      },
    ],
  },
];

type Token = { text: string } | { strong: string } | { cite: number };

function tokenize(segments: Segment[]): Token[] {
  return segments.flatMap((segment): Token[] => {
    if (typeof segment !== "string") return [segment];
    return segment.split(/(?<=\s)/).map((text) => ({ text }));
  });
}

const tokens = answers.map((item) => tokenize(item.answer));

type Phase = "typing" | "streaming" | "done";

export function AskDemo() {
  const section = useRef<HTMLElement>(null);
  const manual = useRef(false);
  const instant = useRef(false);
  const [active, setActive] = useState(0);
  const [typed, setTyped] = useState(answers[0].question.length);
  const [shown, setShown] = useState(tokens[0].length);
  const [phase, setPhase] = useState<Phase>("done");

  const answer = answers[active];
  const stream = tokens[active];

  useMotion(section, ({ motion }, { ScrollTrigger }) => {
    instant.current = !motion;
    const root = section.current;
    if (!root || !motion) return;
    const length = answers[0].question.length;
    setTyped(0);
    setShown(0);
    setPhase("typing");
    ScrollTrigger.create({
      trigger: root,
      start: "top 70%",
      end: "top 15%",
      onUpdate: (self) => {
        if (manual.current) return;
        const count = Math.round(self.progress * length);
        setTyped(count);
        if (count >= length)
          setPhase((current) => (current === "typing" ? "streaming" : current));
      },
      onLeave: () => {
        if (manual.current) return;
        setTyped(length);
        setPhase((current) => (current === "typing" ? "streaming" : current));
      },
    });
  });

  useEffect(() => {
    if (phase !== "typing" || !manual.current) return;
    const timer = window.setInterval(() => {
      setTyped((count) => {
        if (count + 1 >= answer.question.length) {
          setPhase("streaming");
          return answer.question.length;
        }
        return count + 1;
      });
    }, 22);
    return () => window.clearInterval(timer);
  }, [phase, answer.question.length]);

  useEffect(() => {
    if (phase !== "streaming") return;
    const timer = window.setInterval(() => {
      setShown((count) => {
        if (count + 1 >= stream.length) {
          setPhase("done");
          return stream.length;
        }
        return count + 1;
      });
    }, 38);
    return () => window.clearInterval(timer);
  }, [phase, stream.length]);

  const choose = (index: number) => {
    manual.current = true;
    setActive(index);
    if (instant.current) {
      setTyped(answers[index].question.length);
      setShown(tokens[index].length);
      setPhase("done");
      return;
    }
    setTyped(0);
    setShown(0);
    setPhase("typing");
  };

  const done = phase === "done";
  return (
    <section
      ref={section}
      id="ask"
      className="mk-section ask-section"
      data-tone="night"
      aria-labelledby="ask-title"
    >
      <header className="mk-head">
        <h2 id="ask-title">Ask like you would ask an analyst.</h2>
        <p>
          It fetches the data, runs the calculation and answers with the figure,
          the method and the source. These are real answers from the app.
        </p>
      </header>
      <div className="ask">
        <ol className="ask-list" aria-label="Questions">
          {answers.map((item, index) => (
            <li key={item.question}>
              <button
                type="button"
                aria-pressed={index === active}
                onClick={() => choose(index)}
              >
                {item.question}
              </button>
            </li>
          ))}
        </ol>
        <div className="ask-thread" data-phase={phase}>
          <p className="ask-question">
            <span className="sr-only">{answer.question}</span>
            <span aria-hidden>
              {answer.question.slice(0, typed)}
              {phase === "typing" ? <span className="ask-caret" /> : null}
            </span>
          </p>
          <p className="ask-tool" data-visible={phase !== "typing"}>
            {answer.tool}
          </p>
          <p className="ask-answer" aria-live="polite" aria-busy={!done}>
            {stream.slice(0, shown).map((token, index) => {
              const key = `${active}-${index}`;
              if ("text" in token)
                return <Fragment key={key}>{token.text}</Fragment>;
              if ("strong" in token)
                return <strong key={key}>{token.strong}</strong>;
              const source = answer.sources[token.cite - 1];
              const tipId = `cite-${active}-${index}`;
              return (
                <span key={key} className="cite">
                  <button type="button" aria-describedby={tipId}>
                    {token.cite}
                    <span className="sr-only">: source</span>
                  </button>
                  <span role="tooltip" id={tipId} className="cite-tip">
                    <span>{source?.label}</span>
                    <span>{source?.time}</span>
                  </span>
                </span>
              );
            })}
            {phase === "streaming" ? <span className="ask-caret" /> : null}
          </p>
          <ol className="ask-sources" data-visible={done}>
            {answer.sources.map((source, index) => (
              <li key={source.label}>
                <span>{index + 1}</span>
                <span>{source.label}</span>
                <span>{source.time}</span>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </section>
  );
}
