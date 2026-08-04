/**
 * Reads the vault for display.
 *
 * Pages decrypt with the session key rather than asking the background for the
 * contents, so the secrets never travel over runtime messaging. Writes still go
 * through the background (see lib/messages.ts), and `storage.onChanged` is what
 * pulls the result back in here.
 */

import { useCallback, useEffect, useState } from "react";
import { browser } from "../lib/browser";
import {
  clearSessionKey,
  loadSessionKey,
  markActivity,
  storeSessionKey,
} from "../lib/session";
import { readPreferences, readVaultRecord } from "../lib/storage";
import {
  DEFAULT_PREFERENCES,
  type Preferences,
  type VaultPayload,
} from "../lib/types";
import { readVault, unlockWithPassphrase } from "../lib/vault";

export type VaultState =
  | { status: "loading" }
  /** No vault on this machine yet — the API key has never been entered. */
  | { status: "setup" }
  | { status: "locked" }
  | { status: "unlocked"; payload: VaultPayload };

export interface VaultStateHandle {
  state: VaultState;
  preferences: Preferences;
  refresh: () => Promise<void>;
  unlock: (passphrase: string) => Promise<void>;
  lock: () => Promise<void>;
}

export function useVaultState(): VaultStateHandle {
  const [state, setState] = useState<VaultState>({ status: "loading" });
  const [preferences, setPreferences] =
    useState<Preferences>(DEFAULT_PREFERENCES);

  const refresh = useCallback(async () => {
    const [record, prefs] = await Promise.all([
      readVaultRecord(),
      readPreferences(),
    ]);
    setPreferences(prefs);

    if (!record) {
      setState({ status: "setup" });
      return;
    }

    const key = await loadSessionKey();
    if (!key) {
      setState({ status: "locked" });
      return;
    }

    try {
      setState({ status: "unlocked", payload: await readVault(key) });
    } catch {
      // The stored key no longer opens the vault (re-keyed elsewhere).
      await clearSessionKey();
      setState({ status: "locked" });
    }
  }, []);

  useEffect(() => {
    void refresh();

    const listener = () => {
      void refresh();
    };
    browser.storage.onChanged.addListener(listener);
    return () => browser.storage.onChanged.removeListener(listener);
  }, [refresh]);

  const unlock = useCallback(async (passphrase: string) => {
    const { key, payload } = await unlockWithPassphrase(passphrase);
    await storeSessionKey(key);
    setState({ status: "unlocked", payload });
  }, []);

  const lock = useCallback(async () => {
    await clearSessionKey();
    setState({ status: "locked" });
  }, []);

  // Any interaction with an open page counts as activity for the idle timer.
  useEffect(() => {
    if (state.status !== "unlocked") return;
    void markActivity();
  }, [state.status]);

  return { state, preferences, refresh, unlock, lock };
}
