/**
 * Reconciles the local vault with the server.
 *
 * Order matters: local changes are pushed *before* the pull, so the export we
 * read back already contains them and the merge never has to arbitrate between
 * two versions of the same edit. Deletions on the server are mirrored into the
 * local trash rather than applied destructively — a vault that quietly loses
 * secrets when the server has a bad day defeats the point of keeping one.
 */

import type { IAuthenticatorExportAccount } from "@repo/schemas";
import {
  type ApiConfig,
  ApiError,
  createRemoteAccount,
  deleteRemoteAccount,
  fetchExport,
  updateRemoteAccount,
} from "./api";
import { newId, purgeExpiredTrash } from "./entries";
import { readPreferences, writePreferences } from "./storage";
import type {
  SyncResult,
  TrashedEntry,
  VaultEntry,
  VaultPayload,
} from "./types";
import { readVault, writeVault } from "./vault";

export class NotConfiguredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NotConfiguredError";
  }
}

function fromRemote(account: IAuthenticatorExportAccount): VaultEntry {
  return {
    id: newId(),
    serverId: account._id,
    label: account.label,
    issuer: account.issuer,
    accountName: account.accountName,
    secret: account.secret,
    algorithm: account.algorithm,
    digits: account.digits,
    period: account.period,
    createdAt: account.createdAt,
    updatedAt: account.updatedAt,
    serverUpdatedAt: account.updatedAt,
    pendingPush: false,
    pendingDelete: false,
  };
}

function mergeRemote(
  local: VaultEntry,
  account: IAuthenticatorExportAccount,
): VaultEntry {
  return {
    ...local,
    label: account.label,
    issuer: account.issuer,
    accountName: account.accountName,
    secret: account.secret,
    algorithm: account.algorithm,
    digits: account.digits,
    period: account.period,
    updatedAt: account.updatedAt,
    serverUpdatedAt: account.updatedAt,
  };
}

export async function syncVault(key: CryptoKey): Promise<SyncResult> {
  const preferences = await readPreferences();
  const payload = await readVault(key);

  if (!payload.apiKey) {
    throw new NotConfiguredError("No API key stored in the vault");
  }

  const config: ApiConfig = {
    baseUrl: preferences.apiBaseUrl,
    apiKey: payload.apiKey,
  };

  const entries = [...payload.entries];
  let trash = [...payload.trash];
  let pushed = 0;
  let added = 0;
  let updated = 0;
  let trashed = 0;

  // 1. Flush deletions made here while offline.
  for (const [index, entry] of trash.entries()) {
    if (!entry.pendingDelete) continue;

    if (entry.serverId) {
      try {
        await deleteRemoteAccount(config, entry.serverId);
      } catch (error) {
        // Already gone upstream is the outcome we wanted anyway.
        if (!(error instanceof ApiError && error.status === 404)) throw error;
      }
    }

    trash[index] = { ...entry, pendingDelete: false };
    pushed++;
  }

  // 2. Push accounts added here. The server assigns the id we sync against.
  for (const [index, entry] of entries.entries()) {
    if (!entry.pendingPush || entry.serverId) continue;

    const { account } = await createRemoteAccount(config, {
      label: entry.label,
      issuer: entry.issuer,
      accountName: entry.accountName,
      secret: entry.secret,
      algorithm: entry.algorithm,
      digits: entry.digits,
      period: entry.period,
    });

    entries[index] = {
      ...entry,
      serverId: account._id,
      serverUpdatedAt: account.updatedAt,
      pendingPush: false,
    };
    pushed++;
  }

  // 3. Push local renames. The server accepts nothing else on update, so a
  //    secret can never be rewritten out from under an account.
  for (const [index, entry] of entries.entries()) {
    if (!entry.pendingPush || !entry.serverId) continue;

    try {
      const { account } = await updateRemoteAccount(config, entry.serverId, {
        label: entry.label,
        issuer: entry.issuer,
        accountName: entry.accountName,
      });
      entries[index] = {
        ...entry,
        serverUpdatedAt: account.updatedAt,
        pendingPush: false,
      };
      pushed++;
    } catch (error) {
      // Deleted upstream between our last sync and this one; step 5 trashes it.
      if (!(error instanceof ApiError && error.status === 404)) throw error;
    }
  }

  // 4. Pull.
  const remote = await fetchExport(config);
  const remoteIds = new Set<string>();

  for (const account of remote.accounts) {
    remoteIds.add(account._id);

    const index = entries.findIndex((entry) => entry.serverId === account._id);

    if (index === -1) {
      // Reappearing upstream outranks a previous remote-delete.
      trash = trash.filter((entry) => entry.serverId !== account._id);
      entries.push(fromRemote(account));
      added++;
      continue;
    }

    const local = entries[index] as VaultEntry;
    if (local.pendingPush) continue;
    if (local.serverUpdatedAt === account.updatedAt) continue;

    entries[index] = mergeRemote(local, account);
    updated++;
  }

  // 5. Mirror server-side deletions into the trash.
  const survivors: VaultEntry[] = [];
  for (const entry of entries) {
    if (!entry.serverId || remoteIds.has(entry.serverId)) {
      survivors.push(entry);
      continue;
    }

    const removed: TrashedEntry = {
      ...entry,
      deletedAt: new Date().toISOString(),
      reason: "remote",
      pendingDelete: false,
    };
    trash = [removed, ...trash];
    trashed++;
  }

  const reconciled: VaultPayload = {
    ...payload,
    entries: survivors,
    trash,
  };

  const { payload: pruned, purged } = purgeExpiredTrash(
    reconciled,
    preferences.trashRetentionDays,
  );

  await writeVault(key, pruned);

  const at = new Date().toISOString();
  await writePreferences({ lastSyncAt: at, lastSyncError: null });

  return { added, updated, pushed, trashed, purged, at };
}
