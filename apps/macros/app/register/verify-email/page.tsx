import { redirect } from "next/navigation";
import { pageMetadata } from "@/app/metadata";
import {
  parseEmailChangeStep,
  verificationCallbackPath,
} from "@/lib/account/email-change";
import { VerificationError } from "../_components/verification-error";

export const metadata = pageMetadata(
  "Verify Email",
  "Verify your email address to continue setting up Macros.",
);

interface VerifyEmailPageProps {
  searchParams: Promise<{
    token?: string | string[];
    error?: string | string[];
    change?: string | string[];
  }>;
}

function getSingleParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function VerifyEmailPage({
  searchParams,
}: VerifyEmailPageProps) {
  const params = await searchParams;
  const token = getSingleParam(params.token);
  const error = getSingleParam(params.error);
  const change = parseEmailChangeStep(getSingleParam(params.change));

  if (error) {
    return <VerificationError error={error} emailChange={change !== null} />;
  }

  if (!token) {
    return (
      <VerificationError error="INVALID_TOKEN" emailChange={change !== null} />
    );
  }

  const query = new URLSearchParams({
    token,
    callbackURL: verificationCallbackPath(change),
  });
  redirect(`/api/auth/verify-email?${query}`);
}
