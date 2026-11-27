import { ArrowRight } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import {
  MarketingFooter,
  MarketingNav,
  MarketingPage,
} from "@/components/marketing/shell";
import { DenizSignIn } from "@/components/sign-in-actions";
import { Button } from "@/components/ui/button";
import { authReady, currentUser } from "@/lib/auth";
import { freeMonthlyCredits, pricedPacks } from "@/lib/pricing";

export const metadata: Metadata = {
  title: "Pricing · Stockwatcher",
  description:
    "Free to watch: 100 assistant credits every month. Credit packs that never expire. Desks with pooled credits and invoiced billing.",
};

const compare = [
  ["Terminal functions", "All 38", "All 38", "All 38"],
  ["News wire", "Included", "Included", "Included"],
  ["Watchlists", "Included", "Included", "Shared across seats"],
  ["Alerts on 7 channels", "Included", "Included", "Included"],
  ["Interactive Brokers sync", "Included", "Included", "Every seat"],
  ["Assistant credits", "100 a month", "100 a month + packs", "Pooled"],
  ["Billing", "None", "One-time, by card", "Invoice"],
] as const;

const faq = [
  [
    "What is a credit?",
    "A unit of assistant usage. Each answer, morning brief or filing read is charged at what its model run cost, rounded up. Your balance shows next to the assistant.",
  ],
  [
    "Do credits expire?",
    "Packs never expire. The monthly 100 reset on the 1st of each month (UTC) and do not carry over, which is why they are spent before your packs.",
  ],
  [
    "What happens at zero?",
    "The assistant pauses until the 1st or until you add a pack. Terminal functions, the wire, charts, watchlists and alerts keep working.",
  ],
  [
    "Can I cancel?",
    "There is nothing to cancel. Watch is free and packs are one-time purchases, not a subscription. Desks are billed on the terms agreed for the desk.",
  ],
  [
    "Is this investment advice?",
    "No. Stockwatcher is for information only. Every figure carries its source and time so you can check it; the decisions are yours.",
  ],
  [
    "Where does the data come from?",
    "Filings from SEC EDGAR, macro series from FRED, yields from the U.S. Treasury, factor returns from the Kenneth R. French Data Library, quotes and news from Yahoo Finance, and positions from Interactive Brokers when you connect it.",
  ],
] as const;

export default async function PricingPage() {
  const [user, packs] = await Promise.all([currentUser(), pricedPacks()]);
  const signIn = authReady();
  const free = freeMonthlyCredits();

  return (
    <MarketingPage>
      <MarketingNav
        signIn={signIn}
        signedIn={Boolean(user)}
        current="pricing"
      />
      <header className="mk-page-head" data-tone="night">
        <h1>Free to watch. Credits to ask.</h1>
        <p>
          Every account gets {free} assistant credits a month. Terminal
          functions, the news wire, charts and alerts never touch them.
        </p>
      </header>

      <section
        className="mk-section pricing"
        data-tone="paper"
        aria-label="Plans"
      >
        <div className="tiers">
          <article className="tier" aria-labelledby="tier-watch">
            <h2 id="tier-watch">Watch</h2>
            <p className="tier-price">Free</p>
            <p className="tier-text">
              {free} credits every month. Terminal functions, the news wire,
              watchlists and alerts on every channel. No card.
            </p>
            <div className="tier-cta">
              {user ? (
                <Button asChild size="lg">
                  <Link href="/">
                    Open Stockwatcher <ArrowRight />
                  </Link>
                </Button>
              ) : signIn ? (
                <DenizSignIn label="Start free" />
              ) : null}
            </div>
          </article>

          <article className="tier" aria-labelledby="tier-topup">
            <h2 id="tier-topup">Top-up</h2>
            <p className="tier-price">
              from {packs[0]?.price}
              <span>credit packs</span>
            </p>
            <table className="packs">
              <caption className="sr-only">Credit packs</caption>
              <thead>
                <tr>
                  <th scope="col">Credits</th>
                  <th scope="col">Price</th>
                  <th scope="col">Per 100</th>
                </tr>
              </thead>
              <tbody>
                {packs.map((pack) => (
                  <tr key={pack.credits}>
                    <td>{pack.credits.toLocaleString("en-US")}</td>
                    <td>{pack.price}</td>
                    <td>{pack.per100}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="tier-text">
              Packs never expire. Your monthly {free} are used first.
            </p>
            <div className="tier-cta">
              {user ? (
                <Button asChild size="lg" variant="outline">
                  <Link href="/account">
                    Buy credits <ArrowRight />
                  </Link>
                </Button>
              ) : signIn ? (
                <Button asChild size="lg" variant="outline">
                  <a href="/auth/login">
                    Sign in to buy <ArrowRight />
                  </a>
                </Button>
              ) : null}
            </div>
          </article>

          <article className="tier" aria-labelledby="tier-desk">
            <h2 id="tier-desk">Desk</h2>
            <p className="tier-price">Talk to us</p>
            <p className="tier-text">
              Shared watchlists, pooled credits, broker sync for every seat and
              invoiced billing.
            </p>
            <div className="tier-cta">
              <Button asChild size="lg" variant="outline">
                <Link href="/enquire">
                  Desk enquiry <ArrowRight />
                </Link>
              </Button>
            </div>
          </article>
        </div>
        <p className="mk-caption">
          The assistant is metered: an answer is charged at what its model run
          cost. Terminal functions and the wire use no model and are free.
        </p>
      </section>

      <section
        className="mk-section"
        data-tone="paper"
        aria-labelledby="compare-title"
      >
        <h2 id="compare-title" className="mk-label">
          What is in each
        </h2>
        <div className="compare-scroll">
          <table className="compare">
            <thead>
              <tr>
                <th scope="col">
                  <span className="sr-only">Feature</span>
                </th>
                <th scope="col">Watch</th>
                <th scope="col">Top-up</th>
                <th scope="col">Desk</th>
              </tr>
            </thead>
            <tbody>
              {compare.map(([feature, ...plans]) => (
                <tr key={feature}>
                  <th scope="row">{feature}</th>
                  {plans.map((value, index) => (
                    <td
                      key={`${feature}-${index}`}
                      data-none={value === "None" || undefined}
                    >
                      {value}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section
        className="mk-section"
        data-tone="paper"
        aria-labelledby="faq-title"
      >
        <h2 id="faq-title" className="mk-label">
          Questions
        </h2>
        <div className="faq">
          {faq.map(([question, answer]) => (
            <details key={question}>
              <summary>{question}</summary>
              <p>{answer}</p>
            </details>
          ))}
        </div>
      </section>

      <section className="mk-close mk-close-short" data-tone="night">
        <MarketingFooter />
      </section>
    </MarketingPage>
  );
}
