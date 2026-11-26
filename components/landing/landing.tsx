import { Mail, Webhook } from "lucide-react";
import { BrandGlyph } from "@/components/brand-glyph";
import { DenizSignIn, PreviewSignIn } from "@/components/sign-in-actions";
import { quotes } from "@/lib/market";
import type { Quote } from "@/lib/models";
import { AskDemo } from "./ask-demo";
import { AutoplayVideo } from "./autoplay-video";
import { Converge } from "./converge";

const tape = [
  ["^GSPC", "S&P 500"],
  ["^IXIC", "Nasdaq"],
  ["^DJI", "Dow"],
  ["^STOXX50E", "Euro Stoxx 50"],
  ["^FTSE", "FTSE 100"],
  ["^N225", "Nikkei 225"],
  ["^TNX", "US 10Y"],
  ["EURUSD=X", "EUR/USD"],
  ["GC=F", "Gold"],
  ["CL=F", "WTI"],
  ["BTC-USD", "Bitcoin"],
] as const;

const facts = [
  ["500+", "companies' financials in a single calculation"],
  ["8", "primary sources, each cited inline"],
  ["7", "alert channels, from email to webhooks"],
  ["0", "numbers without a source and a time"],
] as const;

const channels = [
  { name: "Email", icon: "mail" },
  { name: "Telegram", src: "/brand/telegram.svg" },
  { name: "WhatsApp", src: "/brand/whatsapp.svg" },
  { name: "Slack", src: "/brand/slack.svg" },
  { name: "Discord", src: "/brand/discord.svg" },
  { name: "ntfy", src: "/brand/ntfy.svg" },
  { name: "Webhooks", icon: "webhook" },
] as const;

const capabilities = [
  ["Charts", "Indicators, drawings, comparisons and saved templates."],
  [
    "Portfolios",
    "A trade ledger with CSV import, P/L per currency and one net value.",
  ],
  [
    "Reports and decks",
    "Written from live data, every figure sourced, shareable by link.",
  ],
  ["Morning brief", "What moved, your book and the news that matters."],
  ["Memory", "Theses, constraints and positions held elsewhere."],
  ["Backtests", "Rule-based strategies on history, labelled hypothetical."],
  ["Supply chains", "Customers and suppliers named in 10-K filings."],
  ["Screens", "Insider clusters and activist stakes across the S&P 500."],
  ["Command line", "Terminal functions: AAPL DES, MOST, ECO."],
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
            <span className="landing-change" data-up={quote.percent >= 0}>
              {quote.percent >= 0 ? "+" : "−"}
              {Math.abs(quote.percent).toFixed(2)}%
            </span>
          ) : null}
        </li>
      ))}
    </ul>
  );
  return (
    <div className="landing-tape" aria-label="Live markets">
      <div className="landing-tape-track">
        {list(false)}
        {list(true)}
      </div>
    </div>
  );
}

function Actions({
  signIn,
  demo,
  label = "Sign in",
}: {
  signIn: boolean;
  demo: boolean;
  label?: string;
}) {
  return (
    <div className="landing-actions">
      {signIn ? <DenizSignIn label={label} /> : null}
      {demo ? <PreviewSignIn /> : null}
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
  const live = await liveTape();
  return (
    <div className="landing">
      <div className="landing-dark landing-top">
        <header className="landing-nav">
          <a className="brand" href="#top">
            <span className="brand-mark">
              <BrandGlyph size={16} />
            </span>
            <span>Stockwatcher</span>
          </a>
          <nav aria-label="Sections">
            <a href="#sources">Sources</a>
            <a href="#ask">Assistant</a>
            <a href="#alerts">Alerts</a>
          </nav>
          {signIn ? <DenizSignIn label="Sign in" size="default" /> : null}
        </header>
        <Tape items={live} />

        <section className="landing-hero" id="top">
          <p className="landing-kicker">
            <span className="landing-pulse" aria-hidden /> Market research
            workspace
          </p>
          <h1>
            <span>Every source.</span>
            <span className="landing-accent">One place to think.</span>
          </h1>
          <p className="landing-lede">
            Filings, macro data, options, insider trades, your broker positions
            and your own research, together in one workspace. Ask a question and
            an assistant reads all of it, does the maths and shows you where
            every number came from.
          </p>
          {notice ? (
            <p className="landing-notice" role="alert">
              {notice}
            </p>
          ) : null}
          <Actions signIn={signIn} demo={demo} label="Get started" />
        </section>
        <div className="landing-stage">
          <AutoplayVideo
            name="pm"
            label="Stockwatcher computing S&P 500 breadth, reading a 10-K and sending an alert."
          />
        </div>
      </div>

      <main className="landing-body">
        <section className="landing-section" id="sources">
          <header className="landing-head">
            <p>Sources</p>
            <h2>Twelve tabs in. One answer out.</h2>
            <span>
              Stockwatcher reads from where the numbers start, not from a
              summary of a summary, and keeps every source attached.
            </span>
          </header>
          <Converge />
        </section>

        <section className="landing-section" id="ask">
          <header className="landing-head">
            <p>Assistant</p>
            <h2>Ask like you would ask an analyst.</h2>
            <span>
              It fetches the data, runs the calculation and answers with the
              figure, the method and the source. These are real answers from the
              app.
            </span>
          </header>
          <AskDemo />
        </section>
      </main>

      <section className="landing-dark landing-facts" aria-label="In numbers">
        <dl>
          {facts.map(([figure, text]) => (
            <div key={text}>
              <dt>{figure}</dt>
              <dd>{text}</dd>
            </div>
          ))}
        </dl>
      </section>

      <div className="landing-body">
        <section className="landing-section">
          <header className="landing-head">
            <p>Who it is for</p>
            <h2>Built for a desk. Just as good for your own account.</h2>
          </header>
          <div className="landing-audiences">
            <article>
              <AutoplayVideo
                name="pm"
                label="Stockwatcher for portfolio managers."
                className="landing-phone"
                vertical
                lazy
              />
              <div>
                <h3>For portfolio managers</h3>
                <ul>
                  <li>Breadth, screens and factor exposure on demand</li>
                  <li>Filing language read and cited by section</li>
                  <li>Stress tests and VaR on the actual book</li>
                </ul>
              </div>
            </article>
            <article>
              <AutoplayVideo
                name="retail"
                label="Stockwatcher for self-directed investors."
                className="landing-phone"
                vertical
                lazy
              />
              <div>
                <h3>For self-directed investors</h3>
                <ul>
                  <li>One net value across accounts and currencies</li>
                  <li>Interactive Brokers synced, nothing retyped</li>
                  <li>What options price in before earnings</li>
                </ul>
              </div>
            </article>
          </div>
        </section>

        <section className="landing-section" id="alerts">
          <header className="landing-head">
            <p>Alerts</p>
            <h2>If you can calculate it, you can be alerted on it.</h2>
            <span>
              Price and volume rules, or a script checked after every close.
              Every trigger is logged and delivered where you will see it.
            </span>
          </header>
          <div className="landing-alerts">
            <ol className="landing-rules">
              <li>
                <code>breadth(S&amp;P 500, 50d) &lt; 40%</code>
                <span>Daily after the US close</span>
              </li>
              <li>
                <code>RSI(NVDA, 14) &lt; 30 and close &gt; SMA(200)</code>
                <span>Daily after the US close</span>
              </li>
              <li>
                <code>insiders(holdings, 30d) ≥ 3 buyers</code>
                <span>Daily</span>
              </li>
            </ol>
            <ul className="landing-channels" aria-label="Delivery channels">
              {channels.map((channel) => (
                <li key={channel.name}>
                  {"src" in channel ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={channel.src} alt="" width={22} height={22} />
                  ) : channel.icon === "mail" ? (
                    <Mail size={22} aria-hidden />
                  ) : (
                    <Webhook size={22} aria-hidden />
                  )}
                  <span>{channel.name}</span>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className="landing-section">
          <header className="landing-head">
            <p>Also inside</p>
            <h2>The rest of the workspace.</h2>
          </header>
          <dl className="landing-grid">
            {capabilities.map(([name, text]) => (
              <div key={name}>
                <dt>{name}</dt>
                <dd>{text}</dd>
              </div>
            ))}
          </dl>
        </section>
      </div>

      <section className="landing-dark landing-close">
        <h2>
          <span>Stop tab-hopping.</span>
          <span className="landing-accent">Start thinking.</span>
        </h2>
        <Actions signIn={signIn} demo={demo} label="Get started" />
        <footer className="landing-foot">
          <span className="brand">
            <span className="brand-mark">
              <BrandGlyph size={14} />
            </span>
            <span>Stockwatcher</span>
          </span>
          <span>For information only. Not investment advice.</span>
          <span>Filings: SEC EDGAR · Macro: FRED · Yields: U.S. Treasury</span>
        </footer>
      </section>
    </div>
  );
}
