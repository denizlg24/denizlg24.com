import { randomBytes } from "node:crypto";

/**
 * Per-device SMB credential lifecycle.
 *
 * Samba holds the credential material; PostgreSQL holds the metadata and the
 * principal that binds a device to one cloud account. Because the two stores
 * cannot be updated atomically, every operation here defines an order whose
 * crash state is recoverable and fails safe.
 */

const PRINCIPAL_PREFIX = "dc-";
/** Samba/Unix names are practically limited; keep well inside it. */
const MAX_PRINCIPAL_LENGTH = 32;

export class SmbCredentialError extends Error {
  constructor(
    message: string,
    readonly code:
      | "INVALID_DEVICE_NAME"
      | "ACCOUNT_DISABLED"
      | "ALREADY_REVOKED"
      | "EXPIRED",
  ) {
    super(message);
    this.name = "SmbCredentialError";
  }
}

/**
 * A principal is derived, never chosen by the caller.
 *
 * It becomes a Unix account name, so a caller-supplied value would put user
 * input into `useradd`. The random suffix also means a re-issued credential for
 * the same device never reuses a principal, so Samba can never confuse a
 * revoked device with its replacement.
 */
export function deriveSmbPrincipal(deviceName: string): string {
  const slug = deviceName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 12);
  if (!slug) {
    throw new SmbCredentialError(
      "Device name has no usable characters",
      "INVALID_DEVICE_NAME",
    );
  }
  const suffix = randomBytes(4).toString("hex");
  return `${PRINCIPAL_PREFIX}${slug}-${suffix}`.slice(0, MAX_PRINCIPAL_LENGTH);
}

/**
 * Reveal-once secret. Long and random because it is used with NTLM, whose
 * challenge-response is offline-crackable if the secret is weak — length is
 * the only defence available at this layer.
 */
export function generateSmbSecret(): string {
  return randomBytes(24).toString("base64url");
}

export interface SmbCredentialRecord {
  expiresAt: Date | null;
  principal: string;
  revokedAt: Date | null;
  userId: string;
}

export interface AccountState {
  disabled: boolean;
}

export type SmbAuthDecision =
  | { allowed: true }
  | { allowed: false; reason: "revoked" | "expired" | "account-disabled" };

/**
 * Whether a credential may authenticate right now.
 *
 * Account state is checked alongside the credential's own state: disabling a
 * cloud account has to close SMB access without requiring every device to be
 * revoked individually, or the account disable is not a security control.
 */
export function evaluateSmbAuth(
  credential: SmbCredentialRecord,
  account: AccountState,
  now: Date,
): SmbAuthDecision {
  if (credential.revokedAt !== null) {
    return { allowed: false, reason: "revoked" };
  }
  if (account.disabled) {
    return { allowed: false, reason: "account-disabled" };
  }
  if (credential.expiresAt !== null && credential.expiresAt <= now) {
    return { allowed: false, reason: "expired" };
  }
  return { allowed: true };
}

export type ProvisionStep =
  | "insert-metadata"
  | "create-samba-account"
  | "enable-samba-account";

export type RevokeStep =
  | "mark-revoked"
  | "disable-samba-account"
  | "close-active-sessions";

/**
 * Provisioning order. Metadata first: a crash then leaves a row with no Samba
 * account, which cannot authenticate and is visible for cleanup. The reverse
 * would leave a working Samba account nothing in the database knows about,
 * which is an unrevocable credential.
 */
export const PROVISION_ORDER: readonly ProvisionStep[] = [
  "insert-metadata",
  "create-samba-account",
  "enable-samba-account",
];

/**
 * Revocation order. Mark first, then disable, then close sessions.
 *
 * A crash after marking leaves a credential that reads as revoked but might
 * still authenticate — wrong, but visible and fixed by re-running. The reverse
 * order leaves one that reads as live but cannot log in, which presents as a
 * broken device and invites someone to "fix" it by re-enabling.
 *
 * Closing sessions last matters: disabling an account does not by itself end
 * an established SMB session, so revocation is not complete until existing
 * sessions are gone.
 */
export const REVOKE_ORDER: readonly RevokeStep[] = [
  "mark-revoked",
  "disable-samba-account",
  "close-active-sessions",
];

export interface ThrottleInput {
  failedAuthCount: number;
  lastFailedAuthAt: Date | null;
  now: Date;
}

const THROTTLE_THRESHOLD = 5;
const THROTTLE_WINDOW_MS = 15 * 60 * 1000;

/**
 * Whether repeated failures should currently block authentication.
 *
 * The counter is only meaningful inside a window: without expiry, five typos
 * spread over a year would lock a device out permanently.
 */
export function smbAuthThrottled(input: ThrottleInput): boolean {
  if (input.failedAuthCount < THROTTLE_THRESHOLD) return false;
  if (!input.lastFailedAuthAt) return false;
  return (
    input.now.getTime() - input.lastFailedAuthAt.getTime() < THROTTLE_WINDOW_MS
  );
}
