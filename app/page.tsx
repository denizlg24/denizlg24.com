import { Suspense } from "react";
import { BrandGlyph } from "@/components/brand-glyph";
import { DenizSignIn, PreviewSignIn } from "@/components/sign-in-actions";
import { Dashboard } from "@/components/dashboard";
import { authReady, currentUser, demoEnabled, isAdmin } from "@/lib/auth";
import { aiEnabled } from "@/lib/ai/config";
import { readWorkspaceView } from "@/lib/db";

const messages: Record<string, string> = {
  retry:
    "The sign-in attempt expired or could not be verified. Please try again.",
  restricted:
    "This Deniz Cloud account does not have access to this Stockwatcher workspace.",
  declined: "Deniz Cloud did not authorize access. You can try again.",
  unavailable: "Deniz Cloud could not be reached. Please try again shortly.",
  setup: "Deniz Cloud sign-in is awaiting configuration.",
};

const desks = [
  [
    "Markets",
    "Benchmarks, heat maps, and price charts across US and European listings.",
  ],
  [
    "Portfolio",
    "Positions at average cost with day and unrealized P/L, kept per currency.",
  ],
  [
    "Research",
    "Company figures and filings from SEC EDGAR, 13F holdings, and your own journal.",
  ],
  ["Alerts", "Price thresholds on any symbol, recorded when they trigger."],
  [
    "Requests",
    "Ask in plain language and the dashboard is built around the answer.",
  ],
] as const;

async function Home({ searchParams }: PageProps<"/">) {
  const user = await currentUser();
  if (user)
    return (
      <Dashboard
        aiEnabled={aiEnabled(user)}
        monitoring={process.env.ALERT_MONITOR === "1"}
        initial={await readWorkspaceView(user.id)}
        account={{
          name: user.name,
          email: user.email,
          demo: user.demo,
          admin: isAdmin(user),
        }}
      />
    );
  const status = (await searchParams).auth;
  const signInEnabled = authReady();
  const edition = new Intl.DateTimeFormat("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date());
  return (
    <main className="sign-in">
      <header className="sign-in-masthead">
        <div className="brand">
          <span className="brand-mark">
            <BrandGlyph size={23} />
          </span>
          <span>Stockwatcher</span>
        </div>
        <p>
          <time>{edition}</time>
          <span>US and European markets</span>
        </p>
      </header>
      <div className="sign-in-body">
        <div className="sign-in-content">
          <h1>Your market workspace.</h1>
          <p className="sign-in-lede">
            Follow markets, research companies, and keep your investment work
            together.
          </p>
          {typeof status === "string" && messages[status] ? (
            <p className="notice" role="alert">
              {messages[status]}
            </p>
          ) : null}
          <div className="sign-in-actions">
            {signInEnabled ? (
              <DenizSignIn />
            ) : (
              <p className="muted">
                Deniz Cloud sign-in is awaiting configuration.
              </p>
            )}
            {demoEnabled() ? <PreviewSignIn /> : null}
          </div>
        </div>
        <section className="sign-in-index" aria-labelledby="sign-in-index">
          <h2 id="sign-in-index">In the workspace</h2>
          <dl>
            {desks.map(([name, text]) => (
              <div key={name}>
                <dt>{name}</dt>
                <dd>{text}</dd>
              </div>
            ))}
          </dl>
        </section>
      </div>
      <footer className="sign-in-foot">
        <span>Market data: Yahoo Finance · Filings: SEC EDGAR</span>
        <span>Sign-in with your Deniz Cloud account</span>
      </footer>
    </main>
  );
}

export default function Page(props: PageProps<"/">) {
  return (
    <Suspense
      fallback={<main className="app-loading">Opening Stockwatcher…</main>}
    >
      <Home {...props} />
    </Suspense>
  );
}
