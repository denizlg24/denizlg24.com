import { Suspense } from "react";
import { Landing } from "@/components/landing/landing";
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
  return (
    <Landing
      notice={typeof status === "string" ? messages[status] : undefined}
      signIn={authReady()}
      demo={demoEnabled()}
    />
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
