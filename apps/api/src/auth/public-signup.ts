import type { Database } from "@repo/cloud-core";
import { authUser } from "@repo/cloud-core/db/schema";
import type { PublicSignUpInput } from "@repo/schemas/cloud";
import { APIError } from "better-auth/api";
import { eq } from "drizzle-orm";

import type { CloudAuth } from "./better-auth";
import { type AuthMailer, existingAccountEmail } from "./email";
import { activeTenant, clientTenancy } from "./tenancy";

export type SignUpRefusal =
  | "SIGNUP_CLOSED"
  | "SIGNUP_INVITE_ONLY"
  | "INVALID_CALLBACK";

export class SignUpRefusedError extends Error {
  override readonly name = "SignUpRefusedError";
  constructor(readonly code: SignUpRefusal) {
    super(code);
  }
}

export interface PublicSignUpDeps {
  auth: CloudAuth;
  db: Database;
  mailer: AuthMailer;
  /** The auth app's origin; the default landing page after verification. */
  authAppUrl: string;
  /** The API's own origin, where an authorization URL lives. */
  apiUrl: string;
}

function resolveCallback(deps: PublicSignUpDeps, value: string | undefined) {
  const fallback = `${deps.authAppUrl.replace(/\/$/, "")}/login`;
  if (!value) return fallback;
  const allowed = [
    new URL(deps.authAppUrl).origin,
    new URL(deps.apiUrl).origin,
  ];
  if (!allowed.includes(new URL(value).origin)) {
    throw new SignUpRefusedError("INVALID_CALLBACK");
  }
  return value;
}

/**
 * Creates a public account for the app behind `clientId`, if its tenant
 * allows sign-up, and mails a verification link that signs the person in and
 * resumes `callbackURL`. An address that already has an account gets a note
 * saying so instead; the caller cannot tell the two apart.
 */
export async function publicSignUp(
  deps: PublicSignUpDeps,
  input: PublicSignUpInput,
): Promise<void> {
  const tenancy = await clientTenancy(deps.db, input.clientId);
  const tenant =
    tenancy?.tenantId && !tenancy.disabled
      ? await activeTenant(deps.db, tenancy.tenantId)
      : null;
  if (!tenant || tenant.signup === "closed") {
    throw new SignUpRefusedError("SIGNUP_CLOSED");
  }
  if (tenant.signup === "invite") {
    throw new SignUpRefusedError("SIGNUP_INVITE_ONLY");
  }
  const callbackURL = resolveCallback(deps, input.callbackURL);

  const notifyExisting = () =>
    deps.mailer.send(
      existingAccountEmail({ to: input.email, signInUrl: callbackURL }),
    );

  const existing = await deps.db.query.authUser.findFirst({
    columns: { id: true },
    where: eq(authUser.email, input.email),
  });
  if (existing) {
    await notifyExisting();
    return;
  }

  try {
    await deps.auth.api.createUser({
      body: {
        email: input.email,
        name: input.name,
        password: input.password,
        role: "user",
      },
    });
  } catch (error) {
    // Lost a race with another sign-up for the same address.
    if (error instanceof APIError && error.status === "BAD_REQUEST") {
      const raced = await deps.db.query.authUser.findFirst({
        columns: { id: true },
        where: eq(authUser.email, input.email),
      });
      if (raced) {
        await notifyExisting();
        return;
      }
    }
    throw error;
  }
  await deps.auth.api.sendVerificationEmail({
    body: { email: input.email, callbackURL },
  });
}
