const SITEVERIFY_URL =
  "https://challenges.cloudflare.com/turnstile/v0/siteverify";

/** The header the auth app sends a Turnstile response in, on every guarded call. */
export const TURNSTILE_HEADER = "x-turnstile-token";

export type TurnstileVerifier = (
  token: string | null | undefined,
  remoteIp: string | null,
) => Promise<boolean>;

export function createTurnstileVerifier(options: {
  secret: string;
  fetch?: typeof fetch;
}): TurnstileVerifier {
  const send = options.fetch ?? fetch;
  return async (token, remoteIp) => {
    if (!token) return false;
    const body = new URLSearchParams({
      secret: options.secret,
      response: token,
    });
    if (remoteIp) body.set("remoteip", remoteIp);
    try {
      const response = await send(SITEVERIFY_URL, {
        method: "POST",
        body,
        signal: AbortSignal.timeout(5_000),
      });
      if (!response.ok) return false;
      const result: unknown = await response.json();
      return (
        typeof result === "object" &&
        result !== null &&
        "success" in result &&
        result.success === true
      );
    } catch {
      return false;
    }
  };
}

/** Local development and tests only. */
export const allowAllTurnstile: TurnstileVerifier = async () => true;
