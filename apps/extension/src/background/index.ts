/**
 * Background worker: the only writer of the vault, plus the timers.
 *
 * Chrome runs this as an MV3 service worker and Firefox as an event page, so it
 * has to assume it can be torn down between events — nothing is kept in module
 * state except the in-flight mutation queue, and the unlocked key is read back
 * from `storage.session` on every wake-up.
 */

import { browser } from "../lib/browser";
import {
  applyEdit,
  createEntry,
  emptyPayload,
  markForDeletion,
  purgeFromTrash,
  restoreFromTrash,
} from "../lib/entries";
import type { ExtensionRequest, ExtensionResponse } from "../lib/messages";
import {
  clearSessionKey,
  lastActivityAt,
  loadSessionKey,
  storeSessionKey,
} from "../lib/session";
import {
  clearAll,
  readPreferences,
  readVaultRecord,
  writePreferences,
  writeVaultRecord,
} from "../lib/storage";
import { NotConfiguredError, syncVault } from "../lib/sync";
import type { SyncResult } from "../lib/types";
import {
  changePassphrase,
  createVault,
  readVault,
  VaultLockedError,
  writeVault,
} from "../lib/vault";

const TICK_ALARM = "tick";
const TICK_PERIOD_MINUTES = 1;

/** Serialises every mutation; concurrent popup edits and timer syncs would
 *  otherwise read-modify-write the same encrypted blob and lose one of them. */
let queue: Promise<unknown> = Promise.resolve();

function enqueue<T>(work: () => Promise<T>): Promise<T> {
  const next = queue.then(work, work);
  queue = next.catch(() => undefined);
  return next;
}

async function requireKey(): Promise<CryptoKey> {
  const key = await loadSessionKey();
  if (!key) throw new VaultLockedError();
  return key;
}

async function handleSetup(
  request: Extract<ExtensionRequest, { type: "setup" }>,
): Promise<SyncResult> {
  await writePreferences({ apiBaseUrl: request.apiBaseUrl });
  const key = await createVault(
    request.passphrase,
    emptyPayload(request.apiKey),
  );
  await storeSessionKey(key);
  return syncVault(key);
}

async function handle(request: ExtensionRequest): Promise<unknown> {
  switch (request.type) {
    case "setup":
      return handleSetup(request);

    case "sync": {
      return syncVault(await requireKey());
    }

    case "addAccounts": {
      const key = await requireKey();
      const payload = await readVault(key);
      const entries = request.inputs.map(createEntry);
      await writeVault(key, {
        ...payload,
        entries: [...entries, ...payload.entries],
      });
      // Best effort: an account added offline still lands, and the next sync
      // pushes it up.
      await syncVault(key).catch(() => undefined);
      return { added: entries.length };
    }

    case "editAccount": {
      const key = await requireKey();
      const payload = await readVault(key);
      await writeVault(key, {
        ...payload,
        entries: payload.entries.map((entry) =>
          entry.id === request.id ? applyEdit(entry, request.edit) : entry,
        ),
      });
      await syncVault(key).catch(() => undefined);
      return null;
    }

    case "deleteAccount": {
      const key = await requireKey();
      const payload = await readVault(key);
      await writeVault(key, markForDeletion(payload, request.id));
      await syncVault(key).catch(() => undefined);
      return null;
    }

    case "restoreAccount": {
      const key = await requireKey();
      const payload = await readVault(key);
      await writeVault(key, restoreFromTrash(payload, request.id));
      await syncVault(key).catch(() => undefined);
      return null;
    }

    case "purgeTrashEntry": {
      const key = await requireKey();
      const payload = await readVault(key);
      await writeVault(key, purgeFromTrash(payload, request.id));
      return null;
    }

    case "emptyTrash": {
      const key = await requireKey();
      const payload = await readVault(key);
      // Entries still holding an unsent delete stay; dropping them would strand
      // the account on the server forever.
      await writeVault(key, {
        ...payload,
        trash: payload.trash.filter((entry) => entry.pendingDelete),
      });
      return null;
    }

    case "changePassphrase": {
      const key = await requireKey();
      const rekeyed = await changePassphrase(key, request.passphrase);
      await storeSessionKey(rekeyed);
      return null;
    }

    case "updateCredentials": {
      const key = await requireKey();
      const payload = await readVault(key);
      await writePreferences({ apiBaseUrl: request.apiBaseUrl });
      await writeVault(key, { ...payload, apiKey: request.apiKey });
      return null;
    }

    case "updatePreferences":
      return writePreferences(request.patch);

    case "replaceVault": {
      // The imported blob is sealed with its own passphrase, so whatever key is
      // in the session no longer opens it.
      await writeVaultRecord(request.record);
      await clearSessionKey();
      return null;
    }

    case "reset": {
      await clearSessionKey();
      await clearAll();
      return null;
    }

    case "lock":
      await clearSessionKey();
      return null;
  }
}

browser.runtime.onMessage.addListener((message: unknown) => {
  const request = message as ExtensionRequest;
  if (!request || typeof request.type !== "string") return undefined;

  return enqueue(async (): Promise<ExtensionResponse<unknown>> => {
    try {
      return { ok: true, data: await handle(request) };
    } catch (error) {
      const failure =
        error instanceof Error ? error : new Error("Unexpected failure");

      if (request.type === "sync" || request.type === "setup") {
        await writePreferences({ lastSyncError: failure.message }).catch(
          () => undefined,
        );
      }

      return { ok: false, error: failure.message, name: failure.name };
    }
  });
});

async function tick(): Promise<void> {
  const key = await loadSessionKey();
  if (!key) return;

  const preferences = await readPreferences();

  const lastActive = await lastActivityAt();
  if (
    lastActive !== null &&
    Date.now() - lastActive > preferences.autoLockMinutes * 60_000
  ) {
    await clearSessionKey();
    return;
  }

  const lastSync = preferences.lastSyncAt
    ? new Date(preferences.lastSyncAt).getTime()
    : 0;
  if (Date.now() - lastSync < preferences.syncIntervalMinutes * 60_000) return;

  await enqueue(() => syncVault(key)).catch(async (error: unknown) => {
    // A background sync failing is normal (offline, server down). Record it for
    // the options page instead of surfacing anything.
    if (error instanceof NotConfiguredError) return;
    await writePreferences({
      lastSyncError: error instanceof Error ? error.message : "Sync failed",
    }).catch(() => undefined);
  });
}

browser.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== TICK_ALARM) return;
  void tick();
});

async function ensureAlarm(): Promise<void> {
  const existing = await browser.alarms.get(TICK_ALARM);
  if (existing) return;
  await browser.alarms.create(TICK_ALARM, {
    periodInMinutes: TICK_PERIOD_MINUTES,
  });
}

browser.runtime.onInstalled.addListener(() => {
  void ensureAlarm();
});

browser.runtime.onStartup.addListener(() => {
  void ensureAlarm();
  // A vault that exists but was never opened this session stays locked; nothing
  // to do beyond making sure the timer is armed.
  void readVaultRecord();
});

void ensureAlarm();
