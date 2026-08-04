/**
 * Pure operations on the vault payload.
 *
 * Kept free of storage and browser imports so the merge and trash rules can be
 * reasoned about — and tested — without an extension around them.
 */

import type {
  TotpAlgorithm,
  TrashedEntry,
  VaultEntry,
  VaultPayload,
} from "./types";

export function emptyPayload(apiKey: string): VaultPayload {
  return { apiKey, entries: [], trash: [] };
}

export function newId(): string {
  return crypto.randomUUID();
}

export interface NewAccountInput {
  label: string;
  issuer: string;
  accountName: string;
  secret: string;
  algorithm: TotpAlgorithm;
  digits: number;
  period: number;
}

export function createEntry(input: NewAccountInput): VaultEntry {
  const now = new Date().toISOString();
  return {
    id: newId(),
    serverId: null,
    label: input.label,
    issuer: input.issuer,
    accountName: input.accountName,
    secret: input.secret.replace(/\s+/g, "").toUpperCase(),
    algorithm: input.algorithm,
    digits: input.digits,
    period: input.period,
    createdAt: now,
    updatedAt: now,
    serverUpdatedAt: null,
    pendingPush: true,
    pendingDelete: false,
  };
}

export type EntryEdit = Pick<VaultEntry, "label" | "issuer" | "accountName">;

/**
 * Only the labels are editable, matching what the server accepts on PATCH. A
 * secret is never rewritten in place — that would silently break the account on
 * one side or the other.
 */
export function applyEdit(entry: VaultEntry, edit: EntryEdit): VaultEntry {
  return {
    ...entry,
    ...edit,
    updatedAt: new Date().toISOString(),
    pendingPush: true,
  };
}

export function markForDeletion(
  payload: VaultPayload,
  id: string,
): VaultPayload {
  const entry = payload.entries.find((candidate) => candidate.id === id);
  if (!entry) return payload;

  const now = new Date().toISOString();
  const trashed: TrashedEntry = {
    ...entry,
    pendingDelete: true,
    updatedAt: now,
    deletedAt: now,
    reason: "local",
  };

  return {
    ...payload,
    entries: payload.entries.filter((candidate) => candidate.id !== id),
    trash: [trashed, ...payload.trash],
  };
}

/**
 * Restores a trashed entry. Anything deleted upstream comes back as a local-only
 * account so the next sync pushes it up again rather than addressing a server id
 * that no longer exists.
 */
export function restoreFromTrash(
  payload: VaultPayload,
  id: string,
): VaultPayload {
  const trashed = payload.trash.find((candidate) => candidate.id === id);
  if (!trashed) return payload;

  const { deletedAt: _deletedAt, reason, ...entry } = trashed;
  const wasRemote = reason === "remote";

  return {
    ...payload,
    entries: [
      {
        ...entry,
        serverId: wasRemote ? null : entry.serverId,
        serverUpdatedAt: wasRemote ? null : entry.serverUpdatedAt,
        pendingDelete: false,
        pendingPush: true,
        updatedAt: new Date().toISOString(),
      },
      ...payload.entries,
    ],
    trash: payload.trash.filter((candidate) => candidate.id !== id),
  };
}

export function purgeFromTrash(
  payload: VaultPayload,
  id: string,
): VaultPayload {
  return {
    ...payload,
    trash: payload.trash.filter((candidate) => candidate.id !== id),
  };
}

/** Drops trash past the retention window. */
export function purgeExpiredTrash(
  payload: VaultPayload,
  retentionDays: number,
  now: number = Date.now(),
): { payload: VaultPayload; purged: number } {
  const cutoff = now - retentionDays * 24 * 60 * 60 * 1000;
  const kept = payload.trash.filter((entry) => {
    // A local delete that never reached the server stays until it syncs,
    // otherwise the account would live on upstream with nothing to remove it.
    if (entry.pendingDelete) return true;
    return new Date(entry.deletedAt).getTime() > cutoff;
  });

  return {
    payload: { ...payload, trash: kept },
    purged: payload.trash.length - kept.length,
  };
}
