// What this browser remembers about passkeys, in its own storage on the auth
// origin. WebAuthn gives a site no way to ask whether a credential exists
// without running a ceremony, so "this device has one" is inferred from the
// last time one was registered or used here, and forgotten when an automatic
// sign-in is dismissed — on a shared family Mac that is somebody else's key.

const DEVICE_KEY = "deniz-auth.passkey-device";
const SNOOZE_KEY = "deniz-auth.passkey-offer-snoozed-until";
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

export function rememberPasskeyDevice(now = new Date()): void {
  write(DEVICE_KEY, now.toISOString());
}

export function forgetPasskeyDevice(): void {
  write(DEVICE_KEY, null);
}

export function hasPasskeyOnDevice(): boolean {
  return read(DEVICE_KEY) !== null;
}

export function snoozePasskeyOffer(now = new Date()): void {
  const until = new Date(now.getTime() + SNOOZE_DAYS * 24 * 60 * 60 * 1000);
  write(SNOOZE_KEY, until.toISOString());
}

export function isPasskeyOfferSnoozed(now = new Date()): boolean {
  const until = read(SNOOZE_KEY);
  if (!until) return false;
  const time = Date.parse(until);
  return Number.isFinite(time) && time > now.getTime();
}
