import { type AuthMailer, logMailer, resendMailer } from "./email";
import {
  allowAllTurnstile,
  createTurnstileVerifier,
  type TurnstileVerifier,
} from "./turnstile";

export interface PublicAccountsRuntime {
  mailer: AuthMailer;
  turnstile: TurnstileVerifier;
}

function emailFrom(env: Record<string, string | undefined>): string {
  return env.AUTH_EMAIL_FROM || "deniz auth <auth@denizlg24.com>";
}

/**
 * Account mail on its own: what the owner's sign-in links need, which unlike
 * self-service does not depend on Turnstile. Same rule as below — never a
 * permissive default on `NODE_ENV`'s say-so.
 */
export function authMailerFromEnv(
  env: Record<string, string | undefined> = process.env,
): AuthMailer | null {
  if (env.RESEND_API_KEY) {
    return resendMailer({ apiKey: env.RESEND_API_KEY, from: emailFrom(env) });
  }
  return env.AUTH_PUBLIC_ACCOUNTS_DEV === "1" ? logMailer() : null;
}

/**
 * Public accounts switch on only when explicitly configured. `NODE_ENV` is
 * folded at bundle time and reads false in the production API, so nothing
 * here may fall back to a permissive default on its say-so: without both a
 * Turnstile secret and a Resend key, sign-up stays off unless
 * `AUTH_PUBLIC_ACCOUNTS_DEV=1` asks for the development stand-ins (no
 * challenge, links in the log).
 */
export function publicAccountsFromEnv(
  env: Record<string, string | undefined> = process.env,
): PublicAccountsRuntime | null {
  if (env.TURNSTILE_SECRET_KEY && env.RESEND_API_KEY) {
    return {
      mailer: resendMailer({
        apiKey: env.RESEND_API_KEY,
        from: emailFrom(env),
      }),
      turnstile: createTurnstileVerifier({ secret: env.TURNSTILE_SECRET_KEY }),
    };
  }
  if (env.AUTH_PUBLIC_ACCOUNTS_DEV === "1") {
    return { mailer: logMailer(), turnstile: allowAllTurnstile };
  }
  return null;
}
