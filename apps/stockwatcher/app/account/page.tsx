import { ArrowUpRight } from "lucide-react";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { AccessTokens } from "@/components/account/access-tokens";
import { BuyButton, PortalButton } from "@/components/account/billing-actions";
import { ProfilePicture } from "@/components/account/profile-picture";
import { appOrigin, authAccountUrl, authAppUrl, currentUser } from "@/lib/auth";
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
import { pictureUrl } from "@/lib/profile-picture";

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

function AuthLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} className="account-auth-link">
      {children}
      <ArrowUpRight aria-hidden size={13} />
    </a>
  );
}

type Credits = Awaited<ReturnType<typeof loadCredits>>;

async function loadCredits(userId: string) {
  const purchasable = polarReady();
  const [current, entries, days, threads, packs] = await Promise.all([
    balance(userId),
    ledger(userId, 100),
    usageByDay(userId, 30),
    listThreads(userId).catch(() => []),
    purchasable ? creditPacks().catch(() => []) : Promise.resolve([]),
  ]);
  return {
    purchasable,
    current,
    entries,
    days,
    packs,
    titles: new Map(threads.map((thread) => [thread.id, thread.title])),
    spent30: days.reduce((sum, day) => sum + day.credits, 0),
  };
}

function CreditSections({
  purchasable,
  current,
  entries,
  days,
  packs,
  titles,
  spent30,
}: Credits) {
  return (
    <>
      <section className="section" id="credits" aria-labelledby="credits-title">
        <header className="section-head">
          <div>
            <h2 id="credits-title">Plan & credits</h2>
            <p>
              {`1 credit is 1 cent of assistant work; market data is free. Free credits reset to ${creditFormat.format(current.freeMonthly)} on ${dayFormat.format(new Date(current.resetsAt))}. Purchased credits do not expire.`}
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
    </>
  );
}

export default async function AccountPage({
  searchParams,
}: PageProps<"/account">) {
  const user = await currentUser();
  if (!user) redirect("/");
  const { checkout } = await searchParams;
  const metered = billingEnabled() && !user.demo;
  const tokensAvailable = !user.demo && Boolean(process.env.DATABASE_URL);
  const [credits, tokens, picture] = await Promise.all([
    metered ? loadCredits(user.id) : Promise.resolve(null),
    tokensAvailable ? listTokens(user.id).catch(() => []) : Promise.resolve([]),
    user.demo ? Promise.resolve(null) : pictureUrl(user.id),
  ]);
  const authHost = new URL(authAppUrl()).host;
  const sections = [
    { id: "profile", label: "Profile" },
    ...(user.demo ? [] : [{ id: "security", label: "Security" }]),
    { id: "credits", label: "Plan & credits" },
    ...(tokensAvailable ? [{ id: "mcp", label: "MCP access" }] : []),
  ];

  return (
    <>
      <header className="view-header">
        <h1>Account</h1>
      </header>
      <nav className="account-index" aria-label="Account sections">
        {sections.map((section) => (
          <a key={section.id} href={`#${section.id}`}>
            {section.label}
          </a>
        ))}
      </nav>

      {checkout ? (
        <p className="account-notice" role="status">
          Payment received. Credits appear here as soon as Polar confirms the
          order, usually within a minute. Refresh to see them.
        </p>
      ) : null}

      <section className="section" id="profile" aria-labelledby="profile-title">
        <header className="section-head">
          <div>
            <h2 id="profile-title">Profile</h2>
            <p>
              {user.demo
                ? "Preview workspaces have no account behind them."
                : "Your name and email come from the deniz auth account you sign in with."}
            </p>
          </div>
        </header>
        <div className="account-profile">
          {user.demo ? null : (
            <ProfilePicture name={user.name} initial={picture} />
          )}
          <dl className="account-rows">
            <div>
              <dt>Name</dt>
              <dd>
                <span className="account-value">{user.name}</span>
                {user.demo ? null : (
                  <span className="account-hint">
                    <AuthLink href={authAccountUrl("account")}>
                      Change on deniz auth
                    </AuthLink>
                    <span>Updates here the next time you sign in.</span>
                  </span>
                )}
              </dd>
            </div>
            <div>
              <dt>Email</dt>
              <dd>
                <span className="account-value">
                  {user.demo
                    ? "Preview workspace"
                    : (user.email ?? "Not shared")}
                </span>
                {user.demo || !user.email ? null : (
                  <span className="account-hint">
                    {user.emailVerified ? "Verified" : "Not verified yet"}
                  </span>
                )}
              </dd>
            </div>
          </dl>
        </div>
      </section>

      {user.demo ? null : (
        <section
          className="section"
          id="security"
          aria-labelledby="security-title"
        >
          <header className="section-head">
            <div>
              <h2 id="security-title">Security</h2>
              <p>
                {`Stockwatcher signs you in with deniz auth, so your password and two-step sign-in are changed there, at ${authHost}. A link there brings you back.`}
              </p>
            </div>
          </header>
          <dl className="account-rows">
            <div>
              <dt>Password</dt>
              <dd>
                <span className="account-value account-note">
                  Needs your current password
                </span>
                <span className="account-hint">
                  <AuthLink href={authAccountUrl("security", "password")}>
                    Change password
                  </AuthLink>
                </span>
              </dd>
            </div>
            <div>
              <dt>Two-factor</dt>
              <dd>
                <span className="account-value account-note">
                  A code from an authenticator app after your password
                </span>
                <span className="account-hint">
                  <AuthLink href={authAccountUrl("security", "two-factor")}>
                    Set up or turn off
                  </AuthLink>
                </span>
              </dd>
            </div>
            <div>
              <dt>Devices</dt>
              <dd>
                <span className="account-value account-note">
                  Passkeys, trusted devices and where you're signed in
                </span>
                <span className="account-hint">
                  <AuthLink href={authAccountUrl("security", "passkeys")}>
                    Review
                  </AuthLink>
                </span>
              </dd>
            </div>
          </dl>
        </section>
      )}

      {credits ? (
        <CreditSections {...credits} />
      ) : (
        <section
          className="section"
          id="credits"
          aria-labelledby="credits-title"
        >
          <header className="section-head">
            <div>
              <h2 id="credits-title">Plan & credits</h2>
            </div>
          </header>
          <p className="empty">
            <strong>Credits are off.</strong>{" "}
            {user.demo
              ? "Preview workspaces do not use credits."
              : "The assistant is not metered on this installation."}
          </p>
        </section>
      )}

      {tokensAvailable ? (
        <section className="section" id="mcp" aria-labelledby="mcp-title">
          <header className="section-head">
            <div>
              <h2 id="mcp-title">MCP access</h2>
              <p>
                Tokens for your own agents at <code>{appOrigin()}/mcp</code>.
                Data tools are free; revoke a token to cut it off.
              </p>
            </div>
          </header>
          <AccessTokens tokens={tokens} endpoint={`${appOrigin()}/mcp`} />
        </section>
      ) : null}
    </>
  );
}
