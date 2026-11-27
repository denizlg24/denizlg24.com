import { redirect } from "next/navigation";
import { AccessTokens } from "@/components/account/access-tokens";
import { BuyButton, PortalButton } from "@/components/account/billing-actions";
import { appOrigin, currentUser } from "@/lib/auth";
import {
  balance,
  billingEnabled,
  type LedgerEntry,
  ledger,
  usageByDay,
} from "@/lib/billing/credits";
import { creditPacks, polarReady } from "@/lib/billing/polar";
import { listTokens } from "@/lib/mcp/tokens";
import { listThreads } from "@/lib/memory";

const creditFormat = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 2,
});
const dayFormat = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  timeZone: "UTC",
});
const stampFormat = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "UTC",
});

const signed = (value: number) =>
  `${value > 0 ? "+" : value < 0 ? "−" : ""}${creditFormat.format(Math.abs(value))}`;

const money = (amount: number, currency: string) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency.toUpperCase(),
  }).format(amount / 100);

const kindLabel: Record<string, string> = {
  free_reset: "Monthly free credits",
  purchase: "Purchase",
  refund: "Refund",
  usage: "Assistant",
  adjust: "Adjustment",
};

const sourceLabel: Record<string, string> = {
  chat: "Assistant",
  brief: "Daily brief",
  "supply-chain": "Supply chain",
};

function describe(entry: LedgerEntry, titles: Map<string, string>) {
  if (entry.kind === "usage") {
    const source = sourceLabel[entry.source ?? ""] ?? "Assistant";
    const thread = entry.threadId ? titles.get(entry.threadId) : undefined;
    return thread ? `${source} · ${thread}` : source;
  }
  if (entry.kind === "purchase" && typeof entry.meta.product === "string")
    return entry.meta.product;
  return kindLabel[entry.kind] ?? entry.kind;
}

export default async function AccountPage({
  searchParams,
}: PageProps<"/account">) {
  const user = await currentUser();
  if (!user) redirect("/");
  const { checkout } = await searchParams;

  if (!billingEnabled() || user.demo)
    return (
      <>
        <header className="view-header">
          <h1>Plan & credits</h1>
        </header>
        <p className="empty">
          <strong>Credits are off.</strong>{" "}
          {user.demo
            ? "Preview workspaces do not use credits."
            : "The assistant is not metered on this installation."}
        </p>
      </>
    );

  const purchasable = polarReady();
  const [current, entries, days, threads, packs, tokens] = await Promise.all([
    balance(user.id),
    ledger(user.id, 100),
    usageByDay(user.id, 30),
    listThreads(user.id).catch(() => []),
    purchasable ? creditPacks().catch(() => []) : Promise.resolve([]),
    listTokens(user.id).catch(() => []),
  ]);
  const titles = new Map(threads.map((thread) => [thread.id, thread.title]));
  const spent30 = days.reduce((sum, day) => sum + day.credits, 0);

  return (
    <>
      <header className="view-header">
        <h1>Plan & credits</h1>
        <p className="meta">
          1 credit is 1 cent of assistant work. The assistant, the daily brief
          and filing reads use credits; market data does not.
        </p>
      </header>

      {checkout ? (
        <p className="account-notice" role="status">
          Payment received. Credits appear here as soon as Polar confirms the
          order, usually within a minute. Refresh to see them.
        </p>
      ) : null}

      <section className="section" aria-labelledby="balance">
        <header className="section-head">
          <div>
            <h2 id="balance">Balance</h2>
            <p>
              {`Free credits reset to ${creditFormat.format(current.freeMonthly)} on ${dayFormat.format(new Date(current.resetsAt))}. Purchased credits do not expire.`}
            </p>
          </div>
        </header>
        <div className="stat-row">
          <div className="figure figure-lg">
            <span className="figure-label">Available</span>
            <strong
              className={`figure-value${current.available <= 0 ? " negative" : ""}`}
            >
              {creditFormat.format(current.available)}
            </strong>
            <span className="figure-sub">credits</span>
          </div>
          <div className="figure">
            <span className="figure-label">Free this month</span>
            <strong className="figure-value">
              {creditFormat.format(Math.max(current.free, 0))}
            </strong>
            <span className="figure-sub">
              of {creditFormat.format(current.freeMonthly)}
            </span>
          </div>
          <div className="figure">
            <span className="figure-label">Purchased</span>
            <strong className="figure-value">
              {creditFormat.format(current.paid)}
            </strong>
            <span className="figure-sub">no expiry</span>
          </div>
          <div className="figure">
            <span className="figure-label">Used</span>
            <strong className="figure-value">
              {creditFormat.format(spent30)}
            </strong>
            <span className="figure-sub">last 30 days</span>
          </div>
          {current.held > 0 ? (
            <div className="figure">
              <span className="figure-label">Reserved</span>
              <strong className="figure-value">
                {creditFormat.format(current.held)}
              </strong>
              <span className="figure-sub">requests running</span>
            </div>
          ) : null}
        </div>
      </section>

      <section className="section" aria-labelledby="buy">
        <header className="section-head">
          <div>
            <h2 id="buy">Buy credits</h2>
            <p>One-time packs. Checkout and receipts by Polar.</p>
          </div>
          {purchasable ? (
            <div className="row-actions">
              <PortalButton />
            </div>
          ) : null}
        </header>
        {!purchasable ? (
          <p className="empty">
            <strong>Purchases are not open yet.</strong> Your free monthly
            credits still work.
          </p>
        ) : packs.length ? (
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Pack</th>
                  <th className="num">Credits</th>
                  <th className="num">Price</th>
                  <th className="num">Per 100 credits</th>
                  <th aria-label="Buy" />
                </tr>
              </thead>
              <tbody>
                {packs.map((pack) => (
                  <tr key={pack.id}>
                    <td>{pack.name}</td>
                    <td className="num">{creditFormat.format(pack.credits)}</td>
                    <td className="num">
                      {money(pack.priceAmount, pack.currency)}
                    </td>
                    <td className="num">
                      {money(
                        Math.round((pack.priceAmount * 100) / pack.credits),
                        pack.currency,
                      )}
                    </td>
                    <td className="num">
                      <BuyButton productId={pack.id} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="empty">
            <strong>No packs are on sale right now.</strong> Try again later.
          </p>
        )}
      </section>

      <section className="section" aria-labelledby="usage">
        <header className="section-head">
          <div>
            <h2 id="usage">Usage by day</h2>
            <p>Last 30 days · UTC</p>
          </div>
        </header>
        {days.length ? (
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Day</th>
                  <th className="num">Requests</th>
                  <th className="num">Credits</th>
                </tr>
              </thead>
              <tbody>
                {[...days].reverse().map((day) => (
                  <tr key={day.day}>
                    <td>
                      {dayFormat.format(new Date(`${day.day}T00:00:00Z`))}
                    </td>
                    <td className="num">{day.runs}</td>
                    <td className="num">{creditFormat.format(day.credits)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="empty">
            <strong>No usage yet.</strong> Ask the assistant something to see it
            here.
          </p>
        )}
      </section>

      <section className="section" aria-labelledby="history">
        <header className="section-head">
          <div>
            <h2 id="history">History</h2>
            <p>Latest 100 entries · UTC</p>
          </div>
        </header>
        <div className="overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr>
                <th>When</th>
                <th>What</th>
                <th className="num">Credits</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <tr key={entry.id}>
                  <td>{stampFormat.format(new Date(entry.createdAt))}</td>
                  <td>{describe(entry, titles)}</td>
                  <td
                    className={`num ${entry.credits > 0 ? "positive" : entry.credits < 0 ? "negative" : "neutral"}`}
                  >
                    {signed(entry.credits)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="section" aria-labelledby="mcp">
        <header className="section-head">
          <div>
            <h2 id="mcp">MCP access</h2>
            <p>
              Tokens for your own agents at <code>{appOrigin()}/mcp</code>. Data
              tools are free; revoke a token to cut it off.
            </p>
          </div>
        </header>
        <AccessTokens tokens={tokens} endpoint={`${appOrigin()}/mcp`} />
      </section>
    </>
  );
}
