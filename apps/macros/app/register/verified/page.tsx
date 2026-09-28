import { primaryButton } from "@/app/_landing/site";
import { pageMetadata } from "@/app/metadata";
import { VerificationError } from "../_components/verification-error";

export const metadata = pageMetadata(
  "Email verified",
  "Your email is verified. Return to the Macros app to finish setting up.",
);

interface EmailVerifiedPageProps {
  searchParams: Promise<{ error?: string | string[] }>;
}

export default async function EmailVerifiedPage({
  searchParams,
}: EmailVerifiedPageProps) {
  const { error } = await searchParams;
  const code = Array.isArray(error) ? error[0] : error;

  if (code) {
    return <VerificationError error={code} />;
  }

  return (
    <div className="space-y-6 pt-2">
      <div>
        <h1 className="text-2xl font-semibold leading-tight tracking-tight">
          Email verified
        </h1>
        <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
          Go back to the Macros app on your iPhone and tap “I’ve verified” to
          finish setting up.
        </p>
      </div>
      <a href="macros://verified" className={`${primaryButton} w-full`}>
        Open Macros
      </a>
    </div>
  );
}
