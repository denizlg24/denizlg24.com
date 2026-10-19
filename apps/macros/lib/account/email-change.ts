import { z } from "zod";
import { getPublicAppOrigin } from "@/lib/email";

const emailChangeStepSchema = z.enum(["confirmed", "verified"]);

/**
 * The step of an email change a link completes: `confirmed` from the current
 * address, which mails the new one, then `verified` from the new address,
 * which applies the change.
 */
export type EmailChangeStep = z.infer<typeof emailChangeStepSchema>;

export function parseEmailChangeStep(value: string | undefined) {
  return emailChangeStepSchema.safeParse(value).data ?? null;
}

// Verification links are opened in a browser, usually on the phone, and the
// app picks up from there. Better Auth appends `?error=` to this path when the
// token is bad, so the page renders both outcomes.
const postVerificationPath = "/register/verified";

export function verificationCallbackPath(change: EmailChangeStep | null) {
  return change
    ? `${postVerificationPath}?change=${change}`
    : postVerificationPath;
}

export function getEmailVerificationUrl(
  token: string,
  change?: EmailChangeStep,
) {
  const url = new URL("/register/verify-email", getPublicAppOrigin());
  url.searchParams.set("token", token);
  if (change) url.searchParams.set("change", change);
  else url.searchParams.set("callbackURL", postVerificationPath);

  return url.toString();
}
