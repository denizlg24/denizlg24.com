import Link from "next/link";
import { primaryButton } from "@/app/_landing/site";
import { pageMetadata } from "@/app/metadata";
import {
  type EmailChangeStep,
  parseEmailChangeStep,
} from "@/lib/account/email-change";
import { VerificationError } from "../_components/verification-error";

interface EmailVerifiedPageProps {
  searchParams: Promise<{
    error?: string | string[];
    change?: string | string[];
  }>;
}

function getSingleParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

const EMAIL_CHANGE_OUTCOMES: Record<
  EmailChangeStep,
  { title: string; body: string }
> = {
  confirmed: {
    title: "Check your new inbox",
    body: "We sent a link to your new address. Open it to finish changing your email. Until then, keep signing in with your current one.",
  },
  verified: {
    title: "Email changed",
    body: "Your Macros account now uses this address. Sign in with it from now on, in the app and on the web.",
  },
};

export async function generateMetadata({
  searchParams,
}: EmailVerifiedPageProps) {
  const change = parseEmailChangeStep(
    getSingleParam((await searchParams).change),
  );
  return change
    ? pageMetadata(EMAIL_CHANGE_OUTCOMES[change].title)
    : pageMetadata(
        "Email verified",
        "Your email is verified. Return to the Macros app to finish setting up.",
      );
}

export default async function EmailVerifiedPage({
  searchParams,
}: EmailVerifiedPageProps) {
  const params = await searchParams;
  const code = getSingleParam(params.error);
  const change = parseEmailChangeStep(getSingleParam(params.change));

  if (code) {
    return <VerificationError error={code} emailChange={change !== null} />;
  }

  if (change) {
    const outcome = EMAIL_CHANGE_OUTCOMES[change];
    return (
      <div className="space-y-6 pt-2">
        <div>
          <h1 className="text-2xl font-semibold leading-tight tracking-tight">
            {outcome.title}
          </h1>
          <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
            {outcome.body}
          </p>
        </div>
        <Link href="/account" className={`${primaryButton} w-full`}>
          Go to your account
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6 pt-2">
      <div>
        <h1 className="text-2xl font-semibold leading-tight tracking-tight">
          Email verified
        </h1>
        <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
          Go back to the Macros app on your phone and tap “I’ve verified” to
          finish setting up.
        </p>
      </div>
      <a href="macros://verified" className={`${primaryButton} w-full`}>
        Open Macros
      </a>
    </div>
  );
}
