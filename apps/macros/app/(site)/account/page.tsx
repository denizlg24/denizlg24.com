import { cn } from "@repo/ui/utils";
import type { Metadata } from "next";
import Link from "next/link";
import { SignIn } from "@/app/_account/sign-in";
import { container } from "@/app/_landing/site";
import { listAccountDevices } from "@/lib/account/devices";
import { getPageSession } from "@/lib/api/page-session";
import { getUserRecipes } from "@/lib/recipes/service";
import { AccountOverview } from "./_components/account-overview";

// Only this page: `/account/delete` stays indexable for App Store review.
export const metadata: Metadata = {
  title: "Account",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function AccountPage() {
  const { session, suspended } = await getPageSession();

  if (!session) {
    return (
      <div className={cn(container, "pt-14 pb-24 sm:pt-20")}>
        {suspended ? (
          <p
            role="status"
            className="mb-10 max-w-[380px] text-sm leading-relaxed text-muted-foreground"
          >
            This account is suspended. Contact{" "}
            <Link
              href="/support"
              className="text-foreground underline underline-offset-4"
            >
              support
            </Link>{" "}
            if you think this is a mistake.
          </p>
        ) : null}
        <SignIn
          title="Sign in to Macros"
          note="Use the same account as the Macros app."
        />
      </div>
    );
  }

  const [devices, recipes] = await Promise.all([
    listAccountDevices(session.user.id, session.session.id),
    getUserRecipes(session.user.id),
  ]);
  const published = recipes.filter((recipe) => recipe.publishedAt).length;

  return (
    <AccountOverview
      user={session.user}
      devices={devices}
      drafts={recipes.length - published}
      published={published}
    />
  );
}
