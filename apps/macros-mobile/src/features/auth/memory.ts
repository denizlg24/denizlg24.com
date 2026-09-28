/**
 * What the sign-up → verify email → sign-in hand-off has to remember between
 * screens. Memory only, on purpose: the password must never reach disk, and
 * losing it to a relaunch only costs typing it once more.
 */
interface PendingCredentials {
  email: string;
  password: string;
}

let pending: PendingCredentials | null = null;
let lastEmail = "";
let resetRequestedFor: string | null = null;
const verificationSentAt = new Map<string, number>();
const resetSentAt = new Map<string, number>();

function key(email: string) {
  return email.trim().toLowerCase();
}

export function rememberPendingCredentials(credentials: PendingCredentials) {
  pending = { email: credentials.email.trim(), password: credentials.password };
  rememberEmail(credentials.email);
}

export function pendingCredentials(): PendingCredentials | null {
  return pending;
}

export function forgetPendingCredentials() {
  pending = null;
}

export function rememberEmail(email: string) {
  lastEmail = email.trim();
}

export function lastUsedEmail(): string {
  return lastEmail;
}

export function markVerificationSent(email: string, at: number = Date.now()) {
  verificationSentAt.set(key(email), at);
}

export function lastVerificationSentAt(email: string): number | null {
  return verificationSentAt.get(key(email)) ?? null;
}

export function markResetRequested(email: string, at: number = Date.now()) {
  resetRequestedFor = email.trim();
  resetSentAt.set(key(email), at);
  rememberEmail(email);
}

export function lastResetSentAt(email: string): number | null {
  return resetSentAt.get(key(email)) ?? null;
}

export function resetRequestedEmail(): string | null {
  return resetRequestedFor;
}

/** A successful sign-in ends every pending hand-off. */
export function clearAuthMemory() {
  pending = null;
  resetRequestedFor = null;
  verificationSentAt.clear();
  resetSentAt.clear();
}
