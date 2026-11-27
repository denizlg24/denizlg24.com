import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { AnimatedMark } from "@/components/marketing/animated-mark";
import { CountUp } from "@/components/marketing/count-up";
import {
  MarketingFooter,
  MarketingNav,
  MarketingPage,
} from "@/components/marketing/shell";
import { Turn } from "@/components/marketing/turn";
import { DenizSignIn, PreviewSignIn } from "@/components/sign-in-actions";
import { quotes } from "@/lib/market";
import type { Quote } from "@/lib/models";
import { freeMonthlyCredits, pricedPacks } from "@/lib/pricing";
import { AlertsFan } from "./alerts-fan";
import { AskDemo } from "./ask-demo";
import { AutoplayVideo } from "./autoplay-video";
import { Converge } from "./converge";
import { HeroLine } from "./hero-line";
import { TerminalDemo } from "./terminal-demo";
import { WireList } from "./wire-list";

const tape = [
  ["^GSPC", "SPX"],
  ["^IXIC", "CCMP"],
  ["^DJI", "INDU"],
  ["^STOXX50E", "SX5E"],
  ["^FTSE", "UKX"],
  ["^N225", "NKY"],
  ["^TNX", "US10Y"],
  ["EURUSD=X", "EURUSD"],
  ["GC=F", "GOLD"],
  ["CL=F", "WTI"],
  ["BTC-USD", "BTC"],
] as const;

const coming = [
  [
    "Live earnings calls",
    "Alerts fire on a phrase while the call is still running.",
  ],
  ["Filing redlines", "What changed in a 10-K since last year’s."],
  ["Scenarios", "“Oil at $120?” reprices your book."],
  ["Voice brief", "Your morning, read to you."],
  ["Stockwatcher for iPhone", "A Live Activity counting down to earnings."],
] as const;

async function liveTape(): Promise<Quote[]> {
  const timeout = new Promise<Quote[]>((resolve) =>
    setTimeout(() => resolve([]), 2500),
  );
  return Promise.race([
    quotes(tape.map(([symbol]) => symbol)).catch(() => []),
    timeout,
  ]);
}

function Tape({ items }: { items: Quote[] }) {
  const bySymbol = new Map(items.map((quote) => [quote.symbol, quote]));
  const rows = tape.flatMap(([symbol, label]) => {
    const quote = bySymbol.get(symbol);
    return quote ? [{ label, quote }] : [];
  });
  if (rows.length < 4) return null;
  const list = (hidden: boolean) => (
    <ul aria-hidden={hidden || undefined}>
      {rows.map(({ label, quote }) => (
        <li key={label}>
          <span>{label}</span>
          <strong>
            {quote.price.toLocaleString("en-US", {
              maximumFractionDigits: quote.price < 20 ? 4 : 2,
              minimumFractionDigits: 2,
            })}
          </strong>
          {quote.percent != null ? (
            <span data-sign={quote.percent >= 0 ? "up" : "down"}>
              {quote.percent >= 0 ? "+" : "−"}
              {Math.abs(quote.percent).toFixed(2)}%
            </span>
          ) : null}
        </li>
      ))}
    </ul>
  );
  return (
    <div className="mk-tape" data-tone="night" aria-label="Live markets">
      <div className="mk-tape-track">
        {list(false)}
        {list(true)}
      </div>
    </div>
  );
}

function Actions({
  signIn,
  demo,
  pricing = true,
}: {
  signIn: boolean;
  demo: boolean;
  pricing?: boolean;
}) {
  return (
    <div className="mk-actions">
      {signIn ? <DenizSignIn label="Start free" /> : null}
      {demo ? <PreviewSignIn label="Preview" /> : null}
      {pricing ? (
        <Link href="/pricing" className="mk-link">
          Pricing <ArrowRight size={15} aria-hidden />
        </Link>
      ) : null}
    </div>
  );
}

export async function Landing({
  notice,
  signIn,
  demo,
}: {
  notice?: string;
  signIn: boolean;
  demo: boolean;
}) {
  const [live, packs] = await Promise.all([liveTape(), pricedPacks()]);
  const free = freeMonthlyCredits();
  const cheapest = packs[0];

  return (
    <MarketingPage>
      <MarketingNav signIn={signIn} />
      <Tape items={live} />

      <section
        className="hero"
        id="top"
        data-tone="night"
        aria-labelledby="hero-title"
      >
        <HeroLine />
        <div className="hero-grid">
          <div className="hero-copy">
            <h1 id="hero-title">
              <span>Terminal power.</span> <span>No terminal price.</span>
            </h1>
            <p className="hero-lede">
              A terminal’s functions, a news wire and an analyst that cites
              every number, free to start.
            </p>
            {notice ? (
              <p className="mk-notice" role="alert">
                {notice}
              </p>
            ) : null}
            <Actions signIn={signIn} demo={demo} />
          </div>
          <div className="hero-w" data-hero-w />
        </div>
        <div className="hero-film">
          <AutoplayVideo
            name="pm"
            label="Stockwatcher: terminal functions, a news wire and an agent that cites every number, without the $30,000 terminal seat."
            className="mk-media"
          />
        </div>
      </section>

      <TerminalDemo />
      <AskDemo />

      <Turn
        from="night"
        to="paper"
        id="sources"
        className="mk-section sources-section"
        labelledBy="sources-title"
      >
        <header className="mk-head">
          <h2 id="sources-title">Twelve tabs in. One answer out.</h2>
          <p>
            Stockwatcher reads from where the numbers start, not from a summary
            of a summary, and keeps every source attached.
          </p>
        </header>
        <Converge />
        <div className="mk-split mk-split-wire">
          <header className="mk-subhead">
            <h3>The wire, de-duplicated.</h3>
            <p>
              Headlines for your watchlists and holdings, merged by story, with
              publisher and time on every line.
            </p>
          </header>
          <WireList />
        </div>
      </Turn>

      <section
        className="mk-section"
        id="alerts"
        data-tone="paper"
        aria-labelledby="alerts-title"
      >
        <header className="mk-head">
          <h2 id="alerts-title">
            If you can calculate it, you can be alerted on it.
          </h2>
          <p>
            One rule, checked after every close, delivered to seven channels.
            Every trigger is logged.
          </p>
        </header>
        <AlertsFan />
        <p className="mk-caption">Example delivery times, UTC</p>
      </section>

      <section
        className="mk-section"
        data-tone="paper"
        aria-labelledby="who-title"
      >
        <header className="mk-head">
          <h2 id="who-title">
            Built for a desk. Just as good for your own account.
          </h2>
        </header>
        <div className="who">
          <article aria-labelledby="who-pm">
            <AutoplayVideo
              name="pm"
              label="Stockwatcher for portfolio managers."
              className="who-phone"
              vertical
              lazy
            />
            <div>
              <h3 id="who-pm">Portfolio managers</h3>
              <dl className="who-figures">
                <div>
                  <dt>
                    <CountUp value={297} /> of 501
                  </dt>
                  <dd>S&amp;P 500 members above their 50-day average</dd>
                </div>
                <div>
                  <dt>
                    <CountUp value={-34.46} decimals={2} suffix="%" signed />
                  </dt>
                  <dd>a sample book in the 2020 Covid replay</dd>
                </div>
                <div>
                  <dt>
                    β <CountUp value={1.15} decimals={2} />
                  </dt>
                  <dd>market beta, Fama-French 5 + momentum</dd>
                </div>
              </dl>
              <ul className="who-list">
                <li>Breadth, screens and factor exposure on demand</li>
                <li>Filing language read and cited by section</li>
                <li>Stress tests and VaR on the actual book</li>
              </ul>
            </div>
          </article>
          <article aria-labelledby="who-retail">
            <AutoplayVideo
              name="retail"
              label="Stockwatcher for self-directed investors."
              className="who-phone"
              vertical
              lazy
            />
            <div>
              <h3 id="who-retail">Self-directed investors</h3>
              <dl className="who-figures">
                <div>
                  <dt>
                    <CountUp value={7.64} decimals={2} prefix="±" suffix="%" />
                  </dt>
                  <dd>move priced into Apple’s 28 Jan report</dd>
                </div>
                <div>
                  <dt>
                    <CountUp value={7} />
                  </dt>
                  <dd>alert channels, from email to webhooks</dd>
                </div>
                <div>
                  <dt>
                    <CountUp value={free} />
                  </dt>
                  <dd>assistant credits every month, free</dd>
                </div>
              </dl>
              <ul className="who-list">
                <li>One net value across accounts and currencies</li>
                <li>Interactive Brokers synced, nothing retyped</li>
                <li>What options price in before earnings</li>
              </ul>
            </div>
          </article>
        </div>
      </section>

      <section
        className="mk-section"
        data-tone="paper"
        aria-labelledby="next-title"
      >
        <header className="mk-head">
          <h2 id="next-title">This is only the beginning.</h2>
        </header>
        <ul className="coming">
          {coming.map(([name, text]) => (
            <li key={name}>
              <span className="mk-coming">Coming</span>
              <strong>{name}</strong>
              <span>{text}</span>
            </li>
          ))}
        </ul>
      </section>

      <section
        className="mk-section teaser-section"
        data-tone="paper"
        aria-labelledby="pricing-teaser"
      >
        <h2 id="pricing-teaser" className="mk-label">
          Pricing
        </h2>
        <div className="teaser">
          <dl>
            <div>
              <dt>Watch</dt>
              <dd>
                <strong>Free</strong>
                <span>{free} credits a month</span>
              </dd>
            </div>
            <div>
              <dt>Top-up</dt>
              <dd>
                <strong>from {cheapest?.price ?? "€9"}</strong>
                <span>packs never expire</span>
              </dd>
            </div>
            <div>
              <dt>Desk</dt>
              <dd>
                <strong>Talk to us</strong>
                <span>pooled credits, invoiced</span>
              </dd>
            </div>
          </dl>
          <Link href="/pricing" className="mk-link">
            Compare plans <ArrowRight size={15} aria-hidden />
          </Link>
        </div>
      </section>

      <Turn
        from="paper"
        to="night"
        className="mk-close"
        labelledBy="close-title"
      >
        <AnimatedMark size={88} trigger="view" className="mk-close-mark" />
        <h2 id="close-title">
          <span>Terminal power.</span> <span>No terminal price.</span>
        </h2>
        <Actions signIn={signIn} demo={demo} pricing={false} />
        <MarketingFooter />
      </Turn>
    </MarketingPage>
  );
}
