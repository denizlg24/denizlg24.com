import { google } from "googleapis";
import { encryptSecret } from "./encrypted-secret";

export const GOOGLE_CALENDAR_PROVIDER = "google" as const;
export const GOOGLE_CALENDAR_DEFAULT_ID = "primary";
export const GOOGLE_CALENDAR_EVENTS_SCOPE =
  "https://www.googleapis.com/auth/calendar.events.owned";
export const GOOGLE_CALENDAR_EMAIL_SCOPES = ["openid", "email"] as const;

const REQUIRED_ENV = [
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "GOOGLE_CALENDAR_REDIRECT_URI",
] as const;

export function getGoogleCalendarConfig() {
  const missing = REQUIRED_ENV.filter((name) => !process.env[name]);
  if (missing.length > 0) {
    throw new Error(`Missing Google Calendar OAuth env: ${missing.join(", ")}`);
  }

  return {
    clientId: process.env.GOOGLE_CLIENT_ID as string,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET as string,
    redirectUri: process.env.GOOGLE_CALENDAR_REDIRECT_URI as string,
  };
}

export function createGoogleCalendarOAuthClient() {
  const { clientId, clientSecret, redirectUri } = getGoogleCalendarConfig();
  return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
}

export function getGoogleCalendarAuthorizationUrl(state: string) {
  const client = createGoogleCalendarOAuthClient();
  return client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    state,
    scope: [GOOGLE_CALENDAR_EVENTS_SCOPE, ...GOOGLE_CALENDAR_EMAIL_SCOPES],
  });
}

export function createGoogleCalendarClient(refreshToken: string) {
  const auth = createGoogleCalendarOAuthClient();
  auth.setCredentials({ refresh_token: refreshToken });
  return google.calendar({ version: "v3", auth });
}

export function encryptedRefreshToken(refreshToken: string) {
  return encryptSecret(refreshToken);
}

export function parseScope(scope: string | string[] | null | undefined) {
  if (Array.isArray(scope)) return scope;
  if (!scope) return [GOOGLE_CALENDAR_EVENTS_SCOPE];
  return scope.split(/\s+/).filter(Boolean);
}

export function extractEmailFromIdToken(idToken: string | null | undefined) {
  if (!idToken) return undefined;

  const [, payload] = idToken.split(".");
  if (!payload) return undefined;

  try {
    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    const decoded = JSON.parse(
      Buffer.from(normalized, "base64").toString("utf8"),
    ) as { email?: unknown };
    return typeof decoded.email === "string" ? decoded.email : undefined;
  } catch {
    return undefined;
  }
}

export function getGoogleApiErrorStatus(error: unknown) {
  if (!error || typeof error !== "object") return undefined;
  const maybeError = error as {
    code?: unknown;
    status?: unknown;
    response?: { status?: unknown };
  };

  if (typeof maybeError.code === "number") return maybeError.code;
  if (typeof maybeError.status === "number") return maybeError.status;
  if (typeof maybeError.response?.status === "number") {
    return maybeError.response.status;
  }

  return undefined;
}

export const GOOGLE_REAUTH_REQUIRED_MESSAGE =
  "Google rejected the stored refresh token (invalid_grant). Reconnect the account.";

function getGoogleErrorReason(error: unknown) {
  if (!error || typeof error !== "object") return undefined;
  const data = (error as { response?: { data?: unknown } }).response?.data;
  if (!data || typeof data !== "object") return undefined;

  const { error: reason } = data as { error?: unknown };
  if (typeof reason === "string") return reason;
  if (reason && typeof reason === "object") {
    const { message } = reason as { message?: unknown };
    if (typeof message === "string") return message;
  }

  return undefined;
}

export function isGoogleInvalidGrantError(error: unknown) {
  if (getGoogleErrorReason(error) === "invalid_grant") return true;
  return error instanceof Error && error.message.includes("invalid_grant");
}

export function sanitizeGoogleSyncError(error: unknown) {
  if (isGoogleInvalidGrantError(error)) return GOOGLE_REAUTH_REQUIRED_MESSAGE;

  const status = getGoogleApiErrorStatus(error);
  const reason = getGoogleErrorReason(error);
  if (status && reason) {
    return `Google Calendar request failed with status ${status} (${reason})`;
  }
  if (status) return `Google Calendar request failed with status ${status}`;
  return "Google Calendar request failed";
}

export function logGoogleCalendarError(context: string, error: unknown) {
  const status = getGoogleApiErrorStatus(error);
  const reason = getGoogleErrorReason(error);
  console.error(
    `[google-calendar] ${context}`,
    JSON.stringify({ status, reason }),
    error instanceof Error ? error.message : error,
  );
}
