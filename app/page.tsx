import { Suspense } from "react";
import { ChartNoAxesCombined } from "lucide-react";
import { DenizSignIn, PreviewSignIn } from "@/components/sign-in-actions";
import { Dashboard } from "@/components/dashboard";
import { authReady, currentUser, demoEnabled } from "@/lib/auth";
import { aiResearchEnabled } from "@/lib/ai-research";
import { readWorkspace } from "@/lib/db";

const messages: Record<string, string> = {
  retry:
    "The sign-in attempt expired or could not be verified. Please try again.",
  restricted:
    "This Deniz Cloud account does not have access to this Stockwatcher workspace.",
  declined: "Deniz Cloud did not authorize access. You can try again.",
  unavailable: "Deniz Cloud could not be reached. Please try again shortly.",
  setup: "Deniz Cloud sign-in is awaiting configuration.",
};

async function Home({ searchParams }: PageProps<"/">) {
  const user = await currentUser();
  if (user)
    return (
      <Dashboard
        webResearch={!user.demo && aiResearchEnabled()}
        monitoring={process.env.ALERT_MONITOR === "1"}
        initial={await readWorkspace(user.id)}
        account={{ name: user.name, email: user.email, demo: user.demo }}
      />
    );
  const status = (await searchParams).auth;
  const signInEnabled = authReady();
  return (
    <main className="sign-in">
      <div className="sign-in-content">
        <div className="brand sign-in-brand">
          <span className="brand-mark">
            <ChartNoAxesCombined size={23} />
          </span>
          <span>Stockwatcher</span>
        </div>
        <h1>Your market workspace.</h1>
        <p>
          Follow markets, research companies, and keep your investment work
          together.
        </p>
        {typeof status === "string" && messages[status] ? (
          <p className="notice" role="alert">
            {messages[status]}
          </p>
        ) : null}
        {signInEnabled ? (
          <DenizSignIn />
        ) : (
          <p className="muted">
            Deniz Cloud sign-in is awaiting configuration.
          </p>
        )}
        {demoEnabled() ? <PreviewSignIn /> : null}
      </div>
      <div className="sign-in-art" aria-hidden="true">
        <div className="art-axis">
          <span>MARKET WATCH</span>
          <span>US / EUROPE</span>
        </div>
        <div className="art-grid">
          {[29, 40, 32, 48, 44, 56, 50, 65, 59, 71, 74, 67, 86, 95].map(
            (height, index) => (
              <i
                key={index}
                style={{ height: `${height}%`, opacity: 0.35 + index * 0.045 }}
              />
            ),
          )}
        </div>
      </div>
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
