import { authClient } from "@/lib/auth-client";
import {
  NATIVE_VERIFICATION_CALLBACK,
  PASSWORD_RESET_REDIRECT,
} from "@/lib/config";
import {
  clearAuthMemory,
  markResetRequested,
  markVerificationSent,
  pendingCredentials,
  rememberEmail,
} from "./memory";

export type AuthFailureKind =
  | "unverified"
  | "invalid-credentials"
  | "rate-limited"
  | "offline"
  | "other";

export interface AuthFailure {
  kind: AuthFailureKind;
  message: string;
}

export type AuthResult = { ok: true } | { ok: false; failure: AuthFailure };

interface BetterAuthError {
  code?: string;
  message?: string;
  status: number;
}

const OFFLINE_MESSAGE = "You’re offline or the server can’t be reached.";

const messages: Record<string, { kind: AuthFailureKind; message: string }> = {
  EMAIL_NOT_VERIFIED: {
    kind: "unverified",
    message: "Verify your email before signing in.",
  },
  INVALID_EMAIL_OR_PASSWORD: {
    kind: "invalid-credentials",
    message: "Wrong email or password.",
  },
  INVALID_EMAIL: { kind: "other", message: "Enter a valid email address." },
  PASSWORD_TOO_SHORT: { kind: "other", message: "Use at least 8 characters." },
  PASSWORD_TOO_LONG: { kind: "other", message: "Use at most 128 characters." },
  USER_ALREADY_EXISTS: {
    kind: "other",
    message: "An account with this email already exists. Sign in instead.",
  },
  USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL: {
    kind: "other",
    message: "An account with this email already exists. Sign in instead.",
  },
  INVALID_PASSWORD: { kind: "invalid-credentials", message: "Wrong password." },
};

function failureFrom(error: BetterAuthError): AuthFailure {
  if (error.status === 429) {
    return {
      kind: "rate-limited",
      message: "Too many attempts. Wait a minute and try again.",
    };
  }
  const known = error.code ? messages[error.code] : undefined;
  if (known) return known;
  return {
    kind: "other",
    message: error.message || "Something went wrong. Try again.",
  };
}

// Better Auth answers server errors in `error`, but a request that never
// reaches the server rejects instead.
async function run(
  call: () => Promise<{ error: BetterAuthError | null }>,
): Promise<AuthResult> {
  try {
    const { error } = await call();
    return error ? { ok: false, failure: failureFrom(error) } : { ok: true };
  } catch {
    return {
      ok: false,
      failure: { kind: "offline", message: OFFLINE_MESSAGE },
    };
  }
}

export async function signInWithPassword(
  email: string,
  password: string,
): Promise<AuthResult> {
  const trimmed = email.trim();
  const result = await run(() =>
    authClient.signIn.email({ email: trimmed, password }),
  );
  if (result.ok) {
    clearAuthMemory();
  } else {
    rememberEmail(trimmed);
  }
  return result;
}

let inFlight: Promise<AuthResult> | null = null;

/**
 * Signs in with the credentials kept from sign-up. The "I've verified" button,
 * the `macros://verified` link and the return-to-foreground check can all
 * fire at once; they share one request.
 */
export function signInWithPendingCredentials(): Promise<AuthResult> | null {
  if (inFlight) return inFlight;
  const credentials = pendingCredentials();
  if (!credentials) return null;
  inFlight = signInWithPassword(
    credentials.email,
    credentials.password,
  ).finally(() => {
    inFlight = null;
  });
  return inFlight;
}

export async function signUpWithPassword(input: {
  name: string;
  email: string;
  password: string;
}): Promise<AuthResult> {
  const email = input.email.trim();
  const result = await run(() =>
    authClient.signUp.email({
      name: input.name.trim(),
      email,
      password: input.password,
      callbackURL: NATIVE_VERIFICATION_CALLBACK,
    }),
  );
  if (result.ok) markVerificationSent(email);
  return result;
}

export async function resendVerificationEmail(
  email: string,
): Promise<AuthResult> {
  const result = await run(() =>
    authClient.sendVerificationEmail({
      email: email.trim(),
      callbackURL: NATIVE_VERIFICATION_CALLBACK,
    }),
  );
  if (result.ok) markVerificationSent(email);
  return result;
}

export async function requestPasswordReset(email: string): Promise<AuthResult> {
  const trimmed = email.trim();
  const result = await run(() =>
    authClient.requestPasswordReset({
      email: trimmed,
      redirectTo: PASSWORD_RESET_REDIRECT,
    }),
  );
  if (result.ok) markResetRequested(trimmed);
  return result;
}

/**
 * Deletes the account and everything in it. The server insists on the
 * password even for a fresh session; the caller clears the device afterwards.
 */
export function deleteAccount(password: string): Promise<AuthResult> {
  return run(() => authClient.deleteUser({ password }));
}
