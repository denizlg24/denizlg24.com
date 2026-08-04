/**
 * Where the unlocked vault key lives between the popup closing and the
 * background waking up.
 *
 * `storage.session` is in-memory and never hits disk, and it is readable only
 * from extension contexts, which is exactly the lifetime we want: one unlock
 * lasts until the browser closes or the idle timer fires, and nothing about the
 * unlocked state survives a restart.
 */

import { browser } from "./browser";
import { exportKey, importKey } from "./crypto";

const KEY_FIELD = "vaultKey";
const ACTIVITY_FIELD = "lastActiveAt";

type SessionArea = {
  get(keys?: string | string[] | null): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(keys: string | string[]): Promise<void>;
};

/** Present since Chrome 102 / Firefox 115, but guard so an old browser degrades
 *  to "always locked" instead of throwing on every call. */
function sessionArea(): SessionArea | null {
  const area = (browser.storage as { session?: SessionArea }).session;
  return area ?? null;
}

export async function storeSessionKey(key: CryptoKey): Promise<void> {
  const area = sessionArea();
  if (!area) return;
  await area.set({
    [KEY_FIELD]: await exportKey(key),
    [ACTIVITY_FIELD]: Date.now(),
  });
}

export async function loadSessionKey(): Promise<CryptoKey | null> {
  const area = sessionArea();
  if (!area) return null;

  const stored = await area.get([KEY_FIELD]);
  const raw = stored[KEY_FIELD];
  if (typeof raw !== "string") return null;

  try {
    return await importKey(raw);
  } catch {
    await clearSessionKey();
    return null;
  }
}

export async function clearSessionKey(): Promise<void> {
  const area = sessionArea();
  if (!area) return;
  await area.remove([KEY_FIELD, ACTIVITY_FIELD]);
}

export async function markActivity(): Promise<void> {
  const area = sessionArea();
  if (!area) return;
  const stored = await area.get([KEY_FIELD]);
  if (typeof stored[KEY_FIELD] !== "string") return;
  await area.set({ [ACTIVITY_FIELD]: Date.now() });
}

export async function lastActivityAt(): Promise<number | null> {
  const area = sessionArea();
  if (!area) return null;
  const stored = await area.get([ACTIVITY_FIELD]);
  const value = stored[ACTIVITY_FIELD];
  return typeof value === "number" ? value : null;
}
