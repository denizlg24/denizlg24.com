// What this browser remembers about passkeys, in its own storage on the auth
// origin. WebAuthn gives a site no way to ask whether a credential exists
// without running a ceremony, so "this device has one" is inferred from the
// last time one was registered or used here, and forgotten when an automatic
// sign-in is dismissed — on a shared family Mac that is somebody else's key.
//
// Two scopes, because the two questions are asked at different moments. The
// automatic prompt on the username step runs before anyone is identified, so
// it can only consult a browser-wide marker. Everything after a sign-in — the
// enrolment offer and its snooze — is about one account, and a marker left by
// a family member on the same Mac must not answer for the next one.

const DEVICE_KEY = "deniz-auth.passkey-device";
const ACCOUNT_DEVICE_PREFIX = "deniz-auth.passkey-device.";
const ACCOUNT_SNOOZE_PREFIX = "deniz-auth.passkey-offer-snoozed-until.";
const SNOOZE_DAYS = 30;

function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string | null): void {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    // Private mode or blocked storage: the marker is a convenience only.
  }
}

/** The browser-wide marker the pre-login automatic prompt reads. */
export function rememberPasskeyDevice(now = new Date()): void {
  write(DEVICE_KEY, now.toISOString());
}

export function forgetPasskeyDevice(): void {
  write(DEVICE_KEY, null);
}

export function hasPasskeyOnDevice(): boolean {
  return read(DEVICE_KEY) !== null;
}

/** Both scopes at once, for the paths that know which account they are for. */
export function rememberAccountPasskeyDevice(
  userId: string,
  now = new Date(),
): void {
  rememberPasskeyDevice(now);
  write(ACCOUNT_DEVICE_PREFIX + userId, now.toISOString());
}

export function accountHasPasskeyOnDevice(userId: string): boolean {
  return read(ACCOUNT_DEVICE_PREFIX + userId) !== null;
}

export function snoozePasskeyOffer(userId: string, now = new Date()): void {
  const until = new Date(now.getTime() + SNOOZE_DAYS * 24 * 60 * 60 * 1000);
  write(ACCOUNT_SNOOZE_PREFIX + userId, until.toISOString());
}

export function isPasskeyOfferSnoozed(
  userId: string,
  now = new Date(),
): boolean {
  const until = read(ACCOUNT_SNOOZE_PREFIX + userId);
  if (!until) return false;
  const time = Date.parse(until);
  return Number.isFinite(time) && time > now.getTime();
}
