/**
 * `storage.local` access: the encrypted vault record and the non-secret
 * preferences. Nothing here can read the vault contents — that needs the key
 * held in `storage.session` (see session.ts).
 */

import { browser } from "./browser";
import {
  DEFAULT_PREFERENCES,
  type Preferences,
  type VaultRecord,
} from "./types";

const VAULT_KEY = "vault";
const PREFERENCES_KEY = "preferences";

export async function readVaultRecord(): Promise<VaultRecord | null> {
  const stored = await browser.storage.local.get(VAULT_KEY);
  return (stored[VAULT_KEY] as VaultRecord | undefined) ?? null;
}

export async function writeVaultRecord(record: VaultRecord): Promise<void> {
  await browser.storage.local.set({ [VAULT_KEY]: record });
}

export async function hasVault(): Promise<boolean> {
  return (await readVaultRecord()) !== null;
}

export async function readPreferences(): Promise<Preferences> {
  const stored = await browser.storage.local.get(PREFERENCES_KEY);
  const saved = (stored[PREFERENCES_KEY] as Partial<Preferences>) ?? {};
  return { ...DEFAULT_PREFERENCES, ...saved };
}

export async function writePreferences(
  patch: Partial<Preferences>,
): Promise<Preferences> {
  const next = { ...(await readPreferences()), ...patch };
  await browser.storage.local.set({ [PREFERENCES_KEY]: next });
  return next;
}

/** Wipes everything, vault included. Used by the options page reset. */
export async function clearAll(): Promise<void> {
  await browser.storage.local.clear();
}
